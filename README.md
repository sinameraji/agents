# Dreamweav

A browser-based home for AI coding agents — think "Jupyter for coding harnesses".

Pick a harness — **OpenCode**, a **built-in Vercel-AI-SDK loop**, **pi**, or **KimiFlare** — point it
at a GitHub repo (or a blank workspace), and drive it from any browser. Each session gets its own
isolated Cloudflare Sandbox container. You bring your own model credits (OpenRouter, Cloudflare AI
Gateway, Anthropic, or OpenAI keys — Dreamweav never bills tokens) and your own GitHub PAT.

Everything runs on Cloudflare: one Worker serves the SPA + API, Durable Objects hold state, Sandbox
containers run the agents, R2 backs up workspaces.

**Dreamweav is self-hosted software.** You deploy it to *your* Cloudflare account: your sessions run
in your containers, your keys bill to you, nobody else's usage lands on your invoice. There is no
hosted service — dreamweav.com is the maintainer's own instance.

## Deploy your own

Requires a Cloudflare account on the **Workers Paid** plan ($5/month, needed for Sandbox containers).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sinameraji/agents)

The button clones this repo into your GitHub account, provisions the R2 buckets and Durable
Objects, and prompts for three secrets plus your email:

- `ENCRYPTION_KEY`: 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts the model
  provider keys you paste into Settings.
- `AUTH_SECRET`: signs the login session cookie (`openssl rand -base64 32`).
- `APP_PASSWORD`: the password you log in with.
- `OWNER_EMAIL` (optional): seeded as the instance owner and admin, so you can invite members.

The first deploy takes several minutes because it builds the sandbox container image. When it
finishes you get `https://agents.<your-subdomain>.workers.dev`. Open it, log in with your
password, and paste a model provider key in Settings (OpenRouter, Anthropic, or OpenAI, or a
Cloudflare API token for Workers AI + AI Gateway unified billing on your own account).

If the button path fails, deploy by hand. You need Node 20+, and Docker running locally to build
the container image:

```sh
git clone https://github.com/sinameraji/agents && cd agents
npm install
npm run deploy                            # first deploy creates the worker (and buckets)
npx wrangler secret put ENCRYPTION_KEY    # openssl rand -base64 32
npx wrangler secret put AUTH_SECRET       # openssl rand -base64 32
npx wrangler secret put APP_PASSWORD
```

`npm run setup` walks the same steps interactively (login check, deploy, then secrets).

## Use your own domain

The workers.dev URL is fully functional. A custom domain is nicer and is required for the
Cloudflare and GitHub OAuth login flows (which need a fixed callback URL you control). Your
domain must be on Cloudflare DNS; the free plan is fine:

1. Cloudflare dashboard > Account Home > Add a domain, and follow the onboarding.
2. At your registrar, disable DNSSEC first, then replace the nameservers with the two Cloudflare
   shows you. Wait until the zone shows Active (usually minutes, can take longer).
3. Attach the domain to the worker: Workers & Pages > agents > Settings > Domains & Routes >
   Add > Custom domain. Or add a `routes` entry to `wrangler.jsonc` and redeploy:

   ```jsonc
   "routes": [{ "pattern": "agents.example.com", "custom_domain": true }]
   ```

## Architecture

```
┌─────────────┐  WebSocket (agents-sdk)  ┌──────────────────┐  containerFetch (poll ~1.2s)
│ Browser SPA │ ◄──────────────────────► │ SessionAgent DO  │ ◄──────────────────────────────┐
│ Vite+React  │   AgentEvent stream      │ (per session)    │                                │
└─────────────┘                          │ · transcript in  │      ┌─────────────────────────┴──┐
       ▲                                 │   DO SQLite      │      │ Cloudflare Sandbox container │
       │ Hono API (sessions, auth,       │ · authoritative  │      │  /workspace (git clone)      │
       │ settings) + UserAgent DO        │   status         │      │  ┌────────────────────────┐  │
       │ (sessions index, encrypted      │ · R2 workspace   │      │  │ OpenCode server   OR   │  │
       │  BYO keys)                      │   backups        │      │  │ bridge :7700 hosting   │  │
       └─────────────────────────────────┴──────────────────┘      │  │ pi / KimiFlare / AI-SDK│  │
                                                                   │  └────────────────────────┘  │
                                                                   └──────────────────────────────┘
```

- **Normalized part model** (`src/shared/agent.ts`): every harness's activity — text, reasoning,
  tool calls with live status, todos, diffs, terminal output, usage — is mapped onto one typed
  `NormPart` stream, so the transcript UI is written once. The same reducer
  (`src/shared/agent-reduce.ts`) applies `AgentEvent`s on both the server (persisting to DO SQLite)
  and the client (rendering).
- **Session status is authoritative**: driven by real harness events in the `SessionAgent` DO, never
  inferred on the client.
- **Two harness paths**: OpenCode runs via `@cloudflare/sandbox/opencode` and is mapped in
  `src/server/harness/opencode-map.ts`; pi, KimiFlare, and the built-in AI-SDK loop run behind a
  small `bridge` HTTP server (`bridge/`) inside the container. The bridge's source ships *inside the
  worker* and is written into the container at runtime, so it always matches the current deploy.
- **Polling transport**: SSE does not stream over the sandbox transport, so the DO polls harness
  state (~1.2s) and diffs against what it has already emitted.
- **Durability**: transcript lives in the DO's SQLite; `/workspace` is snapshotted to R2 and
  restored when a slept container wakes empty.

## Status

| Area | State |
| --- | --- |
| OpenCode harness — end-to-end coding turns, streamed tool cards | ✅ verified |
| Built-in harness (Vercel AI SDK loop, fs + shell tools) | ✅ verified |
| Workspace dock: files browser, config, preview (exposed ports) | ✅ working |
| Persistence: transcript in DO SQLite, R2 workspace backups | ✅ working |
| Plan / build modes, model picker, session rename | ✅ working |
| BYO keys, AES-GCM encrypted at rest; password gate (signed cookie) | ✅ working |
| pi & KimiFlare harnesses (adapters written) | 🚧 verification |
| File uploads, git export (push / PR) | 🚧 in progress |
| Custom domain + Cloudflare Access | 🚧 in progress |
| Sub-agent panel | 🚧 in progress |

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in ENCRYPTION_KEY, APP_PASSWORD, AUTH_SECRET, …
npm run dev                      # vite dev server (Worker + SPA + local DOs)
npm run typecheck
npm test
```

Deploy (requires a **Workers Paid** plan — containers):

```sh
npm run deploy        # generic: root wrangler.jsonc, worker `agents`, *.workers.dev
npm run deploy:self   # maintainer production: generates wrangler.self.jsonc (worker `dreamweav`,
                      # custom domains, send_email) via scripts/make-self-config.mjs
```

Secrets (via `npx wrangler secret put`, or `.dev.vars` locally):

- `ENCRYPTION_KEY` — 32 random bytes, base64; encrypts stored provider keys (`openssl rand -base64 32`)
- `APP_PASSWORD` — the password gate
- `AUTH_SECRET` — HMAC key for the signed session cookie (`openssl rand -base64 32`)
- `OWNER_EMAIL` — optional; seeded as the instance owner/admin

`.dev.vars` also takes `DEV_USER_EMAIL` (local auth bypass; ignored once any real auth is
configured). To run a real coding turn, open Settings in the app and paste a provider key.

## Gotchas we learned

- **SSE doesn't stream over the sandbox transport.** OpenCode's `event.subscribe()` and the bridge's
  events never arrive as a stream through `containerFetch` — so the DO polls full state every ~1.2s
  and diffs, patching parts in place by stable id.
- **Warm-pool containers run stale images.** Baking the bridge into the Docker image meant old
  bridge code after a deploy. Fix: `bridge/dist/bridge.mjs` is imported `?raw` into the worker and
  written into the container at runtime, hash-checked via the bridge's `/health` rev.
- **OpenCode config: set top-level `model` *and* `small_model`, and never include a `models`
  block.** An unpinned small model makes auxiliary calls half-fail invisibly; an incomplete `models`
  block makes OpenCode hang forever with no output.
- **`@git-diff-view` bundles a second Tailwind preflight** that clobbers the app's global styles —
  we render diffs ourselves with Shiki instead.

## License

MIT
