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

1. ~~#6 real modes~~ MERGED + DEPLOYED (165 tests): OpenCode permission preset per mode +
   ocConfigDirty restart; aisdk/cfagent Build ask-before-mutate via ApprovalBroker (5-min timeout =
   denied); per-prompt mode in /prompt body (fixed kimiflare stale boot mode); switcher shows all
   modes, unsupported disabled + title tooltip. LIVE VERIFICATION PENDING: Build-mode ask on aisdk +
   opencode in browser, kimiflare per-prompt mode, mode tooltips on pi. Close issue #6 after.
2. ~~custom-domain wizard~~ MERGED + DEPLOYED (7174533): full stepper (zone create via dns.write,
   NS copy, poll, attach via wireDomain — NOT the workers/domains endpoint, which needs a scope we
   lack). Live verification still pending (needs a real external domain; checklist in the agent
   report / git log 9113a00).
3. ~~budget caps + export~~ MERGED + DEPLOYED (7174533): lifetime-cost fix, month-anchored spend,
   turn-start enforcement (fail-open), /api/me + sidebar meter, markdown export in session menu.
   135/135 tests. Live verification pending: set a cap on a member, watch the block message.
4. ~~OpenCode restart-resume~~ MERGED + DEPLOYED (974b4eb). ROOT CAUSE (Docker-repro verified):
   opencode's SQLite session db lived OUTSIDE /workspace, so container recycles (sleepAfter 10m)
   wiped it; plain restarts were never the problem. Fix: XDG_DATA_HOME=/workspace/.opencode-data
   (rides R2 snapshots), legacy-db migration, self-safe bracketed pkill + pgrep wait, and the
   context-reset note now fires ONLY when session.get says the id is truly gone. Merge resolved
   ocConfigDirty (modes rename) x ocContextLost (truth signal): both semantics kept.
   LIVE VERIFY: teal-model-switch test (expect memory + NO note) and >12min recycle test
   (expect memory) — script in the agent report / branch log.
5. ~~kimiflare custom endpoint~~ DONE, PR OPEN FOR SINA'S REVIEW:
   https://github.com/sinameraji/kimiflare/pull/635 (KIMIFLARE_BASE_URL/API_KEY, live-tested against
   a fake broker, 847/850 = main parity). DONE (b131e5a): 0.99.0 pinned, adapter brokered via
   KIMIFLARE_BASE_URL/API_KEY, raw CF token withheld from container. Issue #3 fully closed.
   LIVE-VERIFIED 2026-08-20: 0.99.0 + broker vars in container + turn over /aig + Build ask. (Fix 47c5a8e: brokered sessions need the FULL catalog model id, bare @cf/ = gateway Invalid provider.) Pending board: claude.ai/code/artifact/ba34665c-9051-458d-8bea-3db18fd8a1c9

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
