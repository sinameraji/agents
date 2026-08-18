# Dreamweav

A hosted, browser-based home for AI coding agents — think "Jupyter for coding harnesses".
Pick a harness (pi, OpenCode, KimiFlare, or a built-in Vercel AI SDK loop), point it at a repo, and drive it
from any browser. Everything runs on Cloudflare (Workers, Durable Objects, Sandbox containers, R2). You bring
your own model credits (OpenRouter, Cloudflare AI Gateway, or provider keys) and your own GitHub.

Inspired by [this thread](https://x.com/patrickc): agentic coding harnesses shouldn't be terminal-first.

## Status

Live foundation, verified end-to-end locally and deployed to Cloudflare.

**Working**
- One Cloudflare Worker serving the Vite/React SPA + Hono API + Agents-SDK Durable Objects.
- Identity via Cloudflare Access (JWKS-verified), with a `DEV_USER_EMAIL` bypass for local dev.
- `UserAgent` DO: sessions index (sidebar) + settings/connections; BYO keys are AES-GCM encrypted at rest.
- `SessionAgent` DO: per-session supervisor that boots **OpenCode inside a Cloudflare Sandbox container**
  (via `@cloudflare/sandbox`'s built-in OpenCode integration) and relays its events to the browser.
- Live UI: session create (GitHub/blank), sidebar, chat shell, connections dialog — all on real DOs.
- Deployed at the workers.dev URL; the sandbox container image builds and ships.

**To run a real coding turn:** open Settings and paste your own OpenRouter key (BYO — Dreamweav never bills tokens).

**Not done yet**
- Custom domain `dreamweav.com` + Cloudflare Access policy (needs a Cloudflare API token with `Zone:DNS:Edit`
  to clear the zone's existing records; the wrangler OAuth token can't).
- Workspace hydration (git clone / upload) + R2/backup snapshots for the "container slept" case.
- Richer OpenCode event mapping (tool detail, usage/cost, sub-agents), approvals, markdown, uploads, GitHub push/PR.
- Additional harnesses (pi, KimiFlare, built-in AI SDK) via the `bridge/` process.

## License

MIT
