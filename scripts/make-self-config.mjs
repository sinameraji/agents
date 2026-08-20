#!/usr/bin/env node
/**
 * Generates wrangler.self.jsonc — the maintainer's PRODUCTION config — from the generic root
 * wrangler.jsonc plus the overrides below. wrangler has no config inheritance, so the self config
 * must be complete and standalone; generating it keeps the two files from drifting apart.
 *
 * The root wrangler.jsonc stays generic on purpose: it is what the "Deploy to Cloudflare" button
 * parses and what strangers deploy (worker `agents`, no routes → *.workers.dev, no send_email).
 * Production MUST keep the worker name `dreamweav` and identical bindings — renaming the worker
 * (or deploying with `--env`, which suffixes the name) would create a fresh worker and orphan all
 * Durable Object data.
 *
 * Usage: node scripts/make-self-config.mjs   (wired into `npm run deploy:self`)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Production overrides. Arrays and scalars REPLACE the generic value; `vars` is merged on top. */
const overrides = {
  name: 'dreamweav',
  // Custom domains (auto-provisioned on deploy; the zone lives on the maintainer's account).
  routes: [
    { pattern: 'agents.insertcompanywebsite.com', custom_domain: true },
    { pattern: 'sina.insertcompanywebsite.com', custom_domain: true },
    { pattern: 'insertcompanywebsite.com', custom_domain: true },
    { pattern: 'www.insertcompanywebsite.com', custom_domain: true },
  ],
  // Magic-link login sender (needs Email Routing on the zone — not portable to other accounts).
  send_email: [{ name: 'EMAIL', remote: true }],
  // Production predates the store/backups split; both bindings share the original bucket.
  r2_buckets: [
    { binding: 'STORE', bucket_name: 'dreamweav-store' },
    { binding: 'BACKUP_BUCKET', bucket_name: 'dreamweav-store' },
  ],
  vars: {
    WORKER_NAME: 'dreamweav',
    // Hosts that render the public "deploy your own" landing page instead of the app.
    LANDING_HOSTS: 'agents.insertcompanywebsite.com',
    // Host where the app lives for the instance owner; login there is Cloudflare-only.
    OWNER_HOST: 'sina.insertcompanywebsite.com',
    OWNER_EMAIL: 'sina.meraji@gmail.com,sina@learningloop.org',
    CF_OAUTH_CLIENT_ID: 'd56dc11cf96142833284da909e60f526',
    GITHUB_OAUTH_CLIENT_ID: 'Ov23li8bFk3eQTcIqfbo',
  },
}

/** Strip // and both block comments from JSONC without touching string contents. */
function stripJsonc(text) {
  let out = ''
  let i = 0
  let inString = false
  while (i < text.length) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += text[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i += 1
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i += 1
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += ch
    i += 1
  }
  // Tolerate trailing commas so a hand-edit of wrangler.jsonc cannot break generation.
  return out.replace(/,\s*([}\]])/g, '$1')
}

const base = JSON.parse(stripJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')))
const self = { ...base, ...overrides, vars: { ...base.vars, ...overrides.vars } }

const header = `// GENERATED FILE — do not edit by hand.
// Produced by scripts/make-self-config.mjs from wrangler.jsonc + production overrides.
// This is the maintainer's production config (worker \`dreamweav\`, custom domains, send_email).
// Deploy with: npm run deploy:self
`
writeFileSync(join(root, 'wrangler.self.jsonc'), header + JSON.stringify(self, null, 2) + '\n')
console.log('wrote wrangler.self.jsonc (worker:', self.name + ')')
