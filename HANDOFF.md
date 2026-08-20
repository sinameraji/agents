# HANDOFF — session state as of 2026-08-20 (afternoon)

For the next agent/session continuing this work. Read CLAUDE.md first. Memory files in
`~/.claude/projects/-Users-sina-opennotopen/memory/` have deep context (esp. dreamweav-build-state.md,
cf-unified-billing.md).

## CRITICAL OPERATIONAL FACTS
- **Production deploys: `npm run deploy:self`** (generates wrangler.self.jsonc, worker `dreamweav`).
  Plain `npm run deploy` deploys the GENERIC root config (worker `agents`) for Deploy-button users —
  NEVER use it for Sina's instance.
- Hosts: agents.insertcompanywebsite.com = public landing; sina.insertcompanywebsite.com = owner
  instance (Cloudflare-only login); bare/www + *.dreamweav.com 308 to agents. (/aig exempt).
- Repo is github.com/sinameraji/agents (renamed from dreamweav). Issues #1-#9 track the roadmap
  (#9 = umbrella). Commit granularly, push to main. No em dashes in UI strings.
- OWNER_EMAIL always-admins: sina.meraji@gmail.com AND sina@learningloop.org (CF identity).
- CF OAuth client d56dc11c… is PUBLIC, 5 redirect URIs, secrets rotated 2026-08-20. GitHub OAuth
  app renamed "Agents", agents. callback added, secret rotated.

## DONE + DEPLOYED + LIVE-VERIFIED (through commit 88ed074)
- P0 complete (#1 OpenCode model switch + permission/question polling; #2 amnesia fixes; #4 hardening).
- kimiflare 0.98.1 (deadlock fix, published) pinned + verified live incl. mid-turn permission approve.
- #5 capability manifest (src/shared/harness-caps.ts) + UI gating — CLOSED.
- #7 partial: native pi steer (bridge POST /steer + DO fallback), reasoning deltas (pi/aisdk/cfagent),
  manifest-driven composer steer hint.
- Access control (OrgAgent DO, v3 migration, membership gate, Members UI) deployed; owner verified.
- Deploy-button readiness: generic root wrangler.jsonc + scripts/make-self-config.mjs + README
  deploy journey + docs/screenshot.png. Transcript polish: thinking never auto-expands; dangling
  tool parts finalize as Interrupted.

## IN FLIGHT — 5 background agents, work lives on these branches (NOT merged, NOT pushed)
Integration order + conflict notes below. If an agent died mid-task, its branch holds whatever it
committed; finish per the plan in its section. Worktrees under .claude/worktrees/agent-<id>/.

1. **worktree-agent-a135e37a6449a29a4 — #6 real modes** (0 commits yet at snapshot time).
   Plan: OpenCode Build=ask/Auto=allow via permission config + restart-on-mode-change (reuse
   ocModelDirty flow); aisdk + cfagent ask-before-mutate permission cards in Build; per-prompt mode
   plumbed to bridges (/prompt {text, mode}); manifest modes updated (opencode/aisdk/cfagent =
   plan+build+auto REAL, pi = build only); mode switcher shows ALL modes, unsupported = disabled +
   tooltip "<Harness> doesn't support <Mode> mode" (Sina's explicit spec).
2. **worktree-agent-abd014774fdbe1c31 — custom-domain wizard** (3 commits: zone derivation utils,
   UserAgent methods, admin /api/domain routes). Left when snapshotted: client Settings→Domain
   stepper UI + wizard-state persistence + tests.
3. **worktree-agent-abd2b0f70d25f7d87 — budget caps + export** (5 commits, looks near-complete:
   lifetime cost fix, month-anchored spend, enforcement at turn start, /api/me + sidebar surface,
   markdown export generator). Verify client export UI exists + tests pass before merging.
4. **worktree-agent-a97d17af028358b5c — OpenCode restart-resume investigation** (0 commits yet).
   Goal: root-cause why restarted OpenCode forgets history despite same session id (suspect storage
   dir not persisted/pinned); fix = pin data dir (e.g. XDG_DATA_HOME=/workspace/.opencode-data) or
   SDK session restore; make the context-reset marker conditional on genuine resume failure.
5. **~/craft/kimiflare branch feat/custom-endpoint** (no commits yet at snapshot). Goal:
   KIMIFLARE_BASE_URL + KIMIFLARE_API_KEY (plain Bearer, no cf-aig-authorization, skip CF preflights)
   so RPC mode runs with zero CF creds → Agents points it at the /aig broker. Ends as PR to
   sinameraji/kimiflare for Sina's review (do NOT push without asking; last PR was #633).

**Integration notes**: branches 1, 3, 4 all touch src/server/agents/session-agent.ts — merge one at a
time (suggested order: 3, 1, 4), run `npm run typecheck && npm test && npm run build` after each,
deploy once via `npm run deploy:self`, live-verify in browser (Build-mode permission card on aisdk,
cap block message, mode tooltips). Branch 1 also touches harness-caps.ts/chat-view/composer which
changed today — expect small conflicts.

## LEFT AFTER THAT (roadmap tail)
- #7 remainder: image model inputs (manifest promptCapabilities.image currently false everywhere).
- #3 finish: after kimiflare custom-endpoint publishes → bump pin, adapter passes /aig broker URL +
  per-session token instead of CF token (see session-agent proxyToken/ensureOpencode for the pattern).
- /aig broker OWNER_HOST dependency: generic deploys skip the cloudflare provider path (derive host
  at session boot instead) — noted by deploy-readiness agent.
- #8 leftovers: cost estimation before send, ACP shim pilot, mid-session model switch for bridges.
- Sina will test the Deploy button with a second CF account (free-plan failure UX unverified).
- Old stash entry on main holds a stale README draft (has a factually wrong external-CNAME claim) —
  safe to drop.
