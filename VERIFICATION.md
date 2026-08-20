# Post-deploy verification — org access control (OrgAgent membership)

Manual live checks to run after `npx wrangler deploy`. **Before deploying, review the
`v3` DO migration in `wrangler.jsonc` (`new_sqlite_classes: ["OrgAgent"]`) — migrations
are one-way in prod.**

## 1. Owner bootstrap (sina.insertcompanywebsite.com)
- [ ] Log in on the owner host with Cloudflare (the only offered provider there).
- [ ] `GET /api/me` returns `{ role: "admin" }` for OWNER_EMAIL — the OrgAgent seeds the
      owner as a bootstrap admin on first access, no manual roster edit needed.
- [ ] Settings shows the **Members** tab; the roster lists the owner as `admin / active`
      with `added_by: bootstrap`.

## 2. Invite flow (Members tab)
- [ ] As admin, invite a second email (role `member`, no cap). It appears in the roster.
- [ ] That person logs in (Cloudflare or GitHub OAuth on the app host) and lands in the
      full app — sessions list loads, a new session can be started.
- [ ] Magic-link login: `POST /api/login/email` for the invited email actually sends a
      link; the link logs them in.

## 3. Gate rejection for non-members
- [ ] Log in with an email that is NOT on the roster: OAuth succeeds, but the app shows
      the "You're not a member yet" screen (not a broken app, not the transcript UI).
- [ ] Confirm the API really rejects them: `GET /api/me` returns `role: null`, and any
      other `/api/*` or `/agents/*` call returns `403 {"error":"not_a_member"}`.
- [ ] Magic-link request for a non-member email returns `{ok:true}` but sends NO email
      (not a membership oracle, no email-bomb vector).
- [ ] As a plain `member`, `GET /api/org/members` returns `403` (admin-only roster).

## 4. Suspend / remove / guardrails
- [ ] Suspend the invited member → their next API call is 403 and the UI drops to the
      ask-your-admin screen; reactivate restores access.
- [ ] Remove them → same rejection; re-invite works.
- [ ] Try to demote/suspend/remove the owner and the last active admin → API refuses
      (`owner_protected` / `last_admin`), roster unchanged.

## 5. Caps (P1: persisted + displayed only — NOT enforced yet)
- [ ] Set a monthly USD cap on a member; it persists across reloads and shows in the
      roster. Do NOT expect spend to be blocked — enforcement is P2.

## 6. Regressions from main that must still work
- [ ] `dreamweav.com`, bare + www `insertcompanywebsite.com` 308 → agents.insertcompanywebsite.com;
      `/aig/<sid>/...` is exempt and still proxies (in-flight sandbox sessions keep working).
- [ ] Owner host offers Cloudflare login only; app host offers CF/GitHub/email/password
      per configuration; landing host renders the landing page.
- [ ] Cloudflare login requests `offline_access` and self-heals via `?basic=1` if the
      OAuth client rejects the scope.
- [ ] An existing session still streams turns, and permission prompts / model switch
      restarts behave as before (membership gate must not break `/agents/*` websockets).
