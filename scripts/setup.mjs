#!/usr/bin/env node
/**
 * One-command self-host setup: verifies wrangler login, deploys once (so the Worker exists),
 * then sets the required secrets only if they are missing. Safe to re-run — existing secrets
 * are left untouched, so keys and sessions survive.
 */
import { execSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import readline from 'node:readline/promises'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const wrangler = (args, opts = {}) => spawnSync('npx', ['wrangler', ...args], { encoding: 'utf8', ...opts })

// 1. Login. `wrangler whoami` exits 0 even when logged OUT, so check the OUTPUT, not the status.
const who = wrangler(['whoami'])
const loggedIn = /associated with the email|Account Name|Account ID/i.test(`${who.stdout}${who.stderr}`)
if (loggedIn) {
  const email = (who.stdout.match(/email (\S+?)[.!\s]/) ?? [])[1]
  console.log(`✔ wrangler is logged in${email ? ` as ${email}` : ''}`)
} else {
  console.log('Not logged into wrangler. Opening login…')
  const login = spawnSync('npx', ['wrangler', 'login'], { stdio: 'inherit' })
  if (login.status !== 0) {
    console.error('wrangler login failed. Run `npx wrangler login` yourself, then re-run npm run setup.')
    process.exit(1)
  }
}

// 2. First deploy — the Worker must exist before `secret put` will accept anything. Also proves
//    the build (including the container image) works before we bother with secrets.
console.log('\nDeploying (creates the Worker if it does not exist yet)…')
const firstDeploy = spawnSync('npm', ['run', 'deploy'], { stdio: 'inherit' })
if (firstDeploy.status !== 0) {
  console.error('\nDeploy failed. Fix the error above (often: not on the Workers Paid plan, needed for containers), then re-run.')
  process.exit(1)
}

// 3. Secrets — only set the ones that are missing, so re-running never rotates existing keys.
const existing = (() => {
  const r = wrangler(['secret', 'list'])
  try {
    return new Set((JSON.parse(r.stdout || '[]') ?? []).map((s) => s.name))
  } catch {
    return new Set()
  }
})()

async function ensureSecret(name, value) {
  if (existing.has(name)) {
    console.log(`• ${name} already set — leaving it.`)
    return
  }
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] })
  if (r.status !== 0) throw new Error(`Failed to set secret ${name}`)
}

console.log('\nSetting missing secrets…')
await ensureSecret('ENCRYPTION_KEY', randomBytes(32).toString('base64'))
await ensureSecret('AUTH_SECRET', randomBytes(32).toString('base64'))

if (!existing.has('APP_PASSWORD')) {
  let password = (await rl.question('Choose an app password (empty = generate one): ')).trim()
  if (!password) {
    password = randomBytes(9).toString('base64url')
    console.log(`Generated app password: ${password}  (save this — it is your login)`)
  }
  await ensureSecret('APP_PASSWORD', password)
} else {
  console.log('• APP_PASSWORD already set — leaving it.')
}

if (!existing.has('OWNER_EMAIL')) {
  const owner = (await rl.question('Your email (becomes the instance owner/admin; empty = password-gate default): ')).trim()
  if (owner) await ensureSecret('OWNER_EMAIL', owner)
}
rl.close()

// 4. Re-deploy so the new secrets are live (first deploy predated them).
console.log('\nRe-deploying with secrets…')
const finalDeploy = spawnSync('npm', ['run', 'deploy'], { stdio: 'inherit' })
if (finalDeploy.status !== 0) {
  console.error('\nFinal deploy failed — see the error above.')
  process.exit(1)
}
console.log('\nDone. Open your worker URL and log in with the app password.')
console.log('Next: paste a model provider key in Settings (OpenRouter / Anthropic / OpenAI / Cloudflare API token).')

// Note: if you have more than one Cloudflare account, set CLOUDFLARE_ACCOUNT_ID in your
// environment (or account_id in wrangler.jsonc) so wrangler picks the right one non-interactively.
