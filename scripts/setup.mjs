#!/usr/bin/env node
/**
 * One-command self-host setup: verifies wrangler login, generates the required secrets,
 * uploads them, and deploys. Safe to re-run (secrets are only set when missing or confirmed).
 */
import { execSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import readline from 'node:readline/promises'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const run = (cmd) => execSync(cmd, { stdio: 'pipe' }).toString()

function putSecret(name, value) {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] })
  if (r.status !== 0) throw new Error(`Failed to set secret ${name}`)
}

// 1. Are we logged in?
try {
  const who = run('npx wrangler whoami')
  const email = who.match(/associated with the email (\S+)/)?.[1] ?? ''
  console.log(`✔ wrangler is logged in${email ? ` as ${email.replace(/\.$/, '')}` : ''}`)
} catch {
  console.log('You are not logged into wrangler. Opening login…')
  spawnSync('npx', ['wrangler', 'login'], { stdio: 'inherit' })
}

// 2. Secrets.
console.log('\nGenerating secrets (ENCRYPTION_KEY, AUTH_SECRET)…')
putSecret('ENCRYPTION_KEY', randomBytes(32).toString('base64'))
putSecret('AUTH_SECRET', randomBytes(32).toString('base64'))

let password = (await rl.question('\nChoose an app password (empty = generate one): ')).trim()
if (!password) {
  password = randomBytes(9).toString('base64url')
  console.log(`Generated app password: ${password}  (save this — it is your login)`)
}
putSecret('APP_PASSWORD', password)

const allowed = (await rl.question('Restrict logins to specific emails? (comma-separated, empty = open): ')).trim()
if (allowed) putSecret('ALLOWED_USERS', allowed)
rl.close()

// 3. Deploy.
console.log('\nBuilding and deploying…')
spawnSync('npm', ['run', 'deploy'], { stdio: 'inherit' })
console.log(`\nDone. Open your worker URL and log in with the app password.`)
console.log('Next: paste a model provider key in Settings (OpenRouter / Anthropic / OpenAI / Cloudflare API token).')
