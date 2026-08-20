# Dreamweav — working notes for agents

**What:** browser UI (Vite + React SPA) + one Cloudflare Worker (Hono + Agents SDK Durable Objects) + a Sandbox
container per session running the user's chosen harness (OpenCode directly; pi / KimiFlare / built-in AI-SDK
loop behind the `bridge` HTTP server on :7700).

**Layout**
- `src/client` — SPA. `components/transcript/` renders the normalized turn/part stream
  (`transcript/parts/` = tool-card, diff-block, todo-list, …); `components/coding-agent/` = chat shell,
  composer, sidebar, settings; `components/workspace/` = files/config/preview dock.
- `src/server` — Worker. `index.ts` + `api/` (Hono routes), `auth/` (password-gate cookie + Access JWKS),
  `agents/user-agent.ts` (sessions index, encrypted connections), `agents/session-agent.ts` (per-session
  supervisor DO: boots sandbox, runs turns, persists transcript in DO SQLite, owns status),
  `harness/opencode-map.ts` (OpenCode events → AgentEvents), `opencode-config.ts`, `crypto.ts` (AES-GCM).
- `src/shared` — `agent.ts` (normalized part model + AgentEvent wire types), `agent-reduce.ts` (one reducer,
  applied server- AND client-side), `protocol.ts` (Session/Harness/Provider/Connections), `models.ts`.
- `bridge/` — container-side harness host. `src/index.ts` (HTTP API: /start /prompt /state /abort /permission),
  `src/session.ts`, `src/adapters/{pi,kimiflare,aisdk}.ts` (+ `jsonl.ts`: split on `\n` only, never readline).

**Rules**
- Cloudflare **GA products only** (Workers, DOs, Agents SDK, Containers, Sandbox SDK, R2, Static Assets).
- Keep the `SessionAgent` DO harness-agnostic: adapters live in `bridge/src/adapters/` +
  `src/server/harness/`; everything is normalized to `src/shared/agent.ts` parts. Status is authoritative,
  driven by real harness events — never inferred on the client.
- SSE does not stream over the sandbox transport — poll state (~1.2s) and diff/patch by stable part id.
- **Runtime bridge injection:** `bridge/dist/bridge.mjs` is imported `?raw` into the worker and written into
  the container at runtime (hash-checked via `/health` rev), so `npm run build -w bridge` must run before
  `vite build` — the root `npm run build` does both. The Docker image only needs Node + the harness CLIs;
  never bake bridge code into the image (warm-pool containers run stale images).
- Durability = git (user's GitHub) + R2 tar snapshots of `/workspace`. Never assume container disk survives sleep.
- BYO credentials only (OpenRouter / Cloudflare AI Gateway / Anthropic / OpenAI keys). Never Claude Pro/Max OAuth.
- Use `npm` (no pnpm). Commit granularly (one logical change per commit); push to `sinameraji/dreamweav`.

**Commands:** `npm run dev` · `npm run build` · `npm run typecheck` · `npm test` ·
PRODUCTION deploy = `npm run deploy:self` (worker `dreamweav` + custom domains + send_email; generates
wrangler.self.jsonc from the generic config via scripts/make-self-config.mjs — production overrides live
THERE, never in wrangler.jsonc). Plain `npm run deploy` uses the root wrangler.jsonc, which is the GENERIC
"Deploy to Cloudflare"-button config (worker `agents`, no routes, no send_email) — keep it deployable on
any account. Never use wrangler `--env` (suffixes the worker name → orphans all DO data).
(Workers Paid; secrets: ENCRYPTION_KEY, APP_PASSWORD, AUTH_SECRET, optional OWNER_EMAIL.)
