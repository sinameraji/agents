# Dreamweav — working notes for agents

**What:** browser UI (Vite + React SPA) + one Cloudflare Worker (Hono + Agents SDK Durable Objects) + a Sandbox
container per session that runs the user's chosen coding harness behind a small `bridge` process.

**Rules**
- Cloudflare **GA products only** (Workers, DOs, Agents SDK runtime, Containers, Sandbox SDK, R2, Static Assets).
  No Artifacts, Project Think, Code Mode.
- The harness runs **inside the container**; the `SessionAgent` DO is a thin supervisor. Keep DO code harness-agnostic.
- Durability = git (user's GitHub) + R2 tar snapshots. Never assume container disk survives sleep.
- BYO credentials only (OpenRouter → Cloudflare AI Gateway → direct keys). Never Claude Pro/Max OAuth.
- Use `npm` (no pnpm). Commit granularly (one logical change per commit); push to `sinameraji/opennotopen`.

**Layout:** `src/client` (SPA) · `src/server` (Worker, agents) · `src/shared` (protocol/types) · `bridge/` (container agent).

**Commands:** `npm run dev` · `npm run build` · `npm run typecheck` · `npm test` · `npx wrangler deploy`.

Plan of record: `~/.claude/plans/gentle-marinating-bird.md` (local).
