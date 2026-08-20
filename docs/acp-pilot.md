# ACP pilot — is the Agent Client Protocol our v2 adapter contract?

**Status:** dark pilot, shipped off. `bridge/src/adapters/kimiflare-acp.ts` drives the same KimiFlare
CLI over ACP instead of its bespoke JSONL RPC; `KIMIFLARE_VIA_ACP` in `bridge/src/session.ts` is the
only switch, and it is `false`. Nothing user-visible changed.

**Recommendation up front: keep ACP as one adapter among many, and steal its vocabulary — not its
wire — for v2.** Reasoning in [Verdict](#verdict).

---

## 1. Protocol facts, with sources

Everything below was read, not recalled.

| Fact | Source |
| --- | --- |
| ACP is JSON-RPC 2.0 over LF-delimited NDJSON on the child's stdio | `@agentclientprotocol/sdk@0.21.1` `dist/stream.js` (`ndJsonStream`); kimiflare `acp/src/index.ts` wires it to `process.stdin/stdout` and redirects `console.*` to stderr so stdout stays pure protocol |
| Spawn command is `kimiflare-acp` | `acp/package.json` → `"bin": { "kimiflare-acp": "bin/kimiflare-acp.mjs" }` |
| **The published CLI has no ACP mode** | `npm view kimiflare@0.99.0 bin` → `{ kimiflare: 'bin/kimiflare.mjs' }`. No `--mode acp`, no second bin |
| **`kimiflare-acp` is not published** | `npm view kimiflare-acp` → `404 Not Found`. It exists only in the kimiflare repo under `acp/` |
| Agent methods | `dist/schema/index.js` `AGENT_METHODS`: `initialize`, `authenticate`, `session/new`, `session/load`, `session/resume`, `session/fork`, `session/list`, `session/close`, `session/prompt`, `session/cancel`, `session/set_mode`, `session/set_model`, `session/set_config_option`, `providers/*`, `nes/*`, `document/did*`, `logout` |
| Client methods (agent → us) | `CLIENT_METHODS`: `session/update`, `session/request_permission`, `fs/read_text_file`, `fs/write_text_file`, `terminal/*`, `elicitation/*` |
| `PROTOCOL_VERSION = 1` | `dist/schema/index.js` |
| Handshake shapes | `InitializeRequest{protocolVersion, clientCapabilities, clientInfo}` → `InitializeResponse{protocolVersion, agentInfo, agentCapabilities, authMethods}`; `NewSessionRequest{cwd, mcpServers, additionalDirectories?}` → `NewSessionResponse{sessionId, modes?, models?, configOptions?}`; `PromptRequest{sessionId, prompt: ContentBlock[], messageId?}` → `PromptResponse{stopReason, usage?, userMessageId?}` — `types.gen.d.ts` :1817, :3060, :3343 |
| Streaming shapes | `SessionUpdate` union (`types.gen.d.ts` :4331): `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`, `usage_update` |
| Permission is a **request**, not an event | `CLIENT_METHODS.session_request_permission`; `RequestPermissionRequest{sessionId, toolCall, options: PermissionOption[]}` → `RequestPermissionResponse{outcome}` where `outcome` is `{outcome:'cancelled'}` or `{outcome:'selected', optionId}` |
| Permission option kinds | `PermissionOptionKind = 'allow_once' \| 'allow_always' \| 'reject_once' \| 'reject_always'`; the **agent** supplies the option list and its ids/labels |
| Stop reasons | `StopReason = 'end_turn' \| 'max_tokens' \| 'max_turn_requests' \| 'refusal' \| 'cancelled'` |
| **Resume exists in the spec** | `session/load` (replays the transcript, gated on `agentCapabilities.loadSession`), `session/resume` (no replay, gated on `sessionCapabilities.resume`), `session/fork` |
| **…but this peer implements none of it** | `acp/src/agent.ts` `initialize()` returns only `promptCapabilities:{image:true}` and `sessionCapabilities:{close:{},list:{}}`. No `loadSession`, no `resume`, no `fork` |
| KimiFlare's ACP modes | `edit` / `plan` / `auto`, initial mode from the `ACP_PERMISSION_MODE` env var — `acp/src/agent.ts` `AVAILABLE_MODES`, `resolveDefaultMode()` |
| KimiFlare's ACP tool mapping | `acp/src/tools.ts`: `toolKind()` (read/edit/execute/search/fetch/think/other), `toolTitle()` (`"$ npm test"`, `"Read foo.ts"`), diff content blocks for write/edit, `permissionOptions()` → `allow_once` / `allow_session` / `deny` |
| Credentials/model reach the CLI by env only | `kimiflare/src/config.ts` — `KIMIFLARE_BASE_URL` + `KIMIFLARE_API_KEY` (a complete setup on their own, :627), `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN`, `KIMI_MODEL` (:366) |

Two discrepancies worth recording:

- kimiflare's own `acp/src/integration.test.ts` sends `session/setMode`, but the wire name in the SDK
  it compiles against (`^0.21.0` → 0.21.0, per `acp/package-lock.json`) is **`session/set_mode`**.
  Our adapter uses the constant.
- `session/new` in this peer calls `loadConfig()` and throws `RequestError.authRequired` when no
  Cloudflare credentials are present — so the ACP handshake fails *late*, at session creation, not at
  `initialize`.

## 2. Coverage: ACP vs our bespoke KimiFlare RPC

The RPC baseline is `kimiflare/src/sdk/rpc.ts` + `types.ts` (commands `new_session`, `prompt`,
`abort`, `resolve_permission`, `set_mode`, `set_model`, `steer`, `follow_up`, `get_state`,
`dispose`), as consumed by `bridge/src/adapters/kimiflare.ts`.

| Capability | Bespoke RPC | ACP | Winner |
| --- | --- | --- | --- |
| **Turn lifecycle** | Race two signals: the `ok` ack carrying our command id, *or* `session.end` — the adapter needs a `finished` latch to dedupe | The `session/prompt` **request resolves**, carrying `stopReason` | **ACP**, decisively |
| **Streaming text** | `message.delta{messageId, text}` | `agent_message_chunk{messageId?, content}` | Tie |
| **Reasoning** | `message.reasoning{text}` | `agent_thought_chunk` | Tie |
| **Tool call states** | 2: `tool.start` → `tool.result{isError}` | 4: `pending`/`in_progress`/`completed`/`failed`, with unlimited `tool_call_update` patches | **ACP** |
| **Tool identity** | `toolName` verbatim (`bash`, `read`) | **No name at all** — only `title` (human, `"$ npm test"`) and `kind` (10-value enum) | **RPC** |
| **Structured diffs** | None; results are a flat string | `ToolCallContent{type:'diff', path, oldText, newText}` + `locations[]` for follow-along | **ACP** |
| **Todos / plan** | `tasks.update{tasks:[{title,status}]}` | `plan{entries:[{content,status,priority}]}` | Tie (ACP adds priority) |
| **Permission transport** | Fire-and-forget `permission.request` event + `resolve_permission` command | A blocking JSON-RPC **request** we must answer | Split — see §3 |
| **Permission granularity** | Fixed enum `allow`/`allow_session`/`deny` | Agent-authored `PermissionOption[]` with `kind` + human `name` per request | **ACP** |
| **Modes** | `set_mode` with a hard-coded `plan\|edit\|auto` | `session/new` returns `SessionModeState{currentModeId, availableModes:[{id,name,description}]}`; `session/set_mode`; `current_mode_update` notification | **ACP**, decisively |
| **Model switch** | `set_model` command | `session/set_model` exists, but only if the agent returns `models` from `session/new` — **this peer returns none**, so the model is fixed at spawn via `KIMI_MODEL` | **RPC** (peer gap, not a spec gap) |
| **Steering mid-turn** | `steer` and `follow_up` commands | **Nothing.** No method, no notification, no shape | **RPC** |
| **Images** | `PromptOptions.images` exists (our adapter never wired it) | `promptCapabilities.image` negotiated at `initialize` + `ContentBlock{type:'image', data, mimeType}` | **ACP** |
| **Usage** | `usage{inputTokens, outputTokens, reasoningTokens, cost}` **per API call**, live during the turn | `usage_update` is a *context-window meter* (`used` of `size`); real tokens arrive once, in `PromptResponse.usage`, a field the SDK marks `**UNSTABLE** @experimental` | **RPC** |
| **Cost** | `usage.cost` per call | `UsageUpdate.cost: Cost{amount,currency}` exists — **this peer never sends it** | **RPC** |
| **Resume** | `new_session{sessionId}` resumes; the bridge depends on it for restart-with-resume | `session/load` / `session/resume` / `session/fork`, all capability-gated — **this peer advertises none** | **RPC** (peer gap) |
| **Capability discovery** | None. Zero introspection — hence the hand-maintained `src/shared/harness-caps.ts` | `initialize` → `AgentCapabilities`; `session/new` → modes, models, config options | **ACP**, decisively |
| **Slash commands** | None | `available_commands_update{availableCommands:[{name,description,input}]}` | **ACP** (not exercised — this peer never sends it) |
| **Subagents** | None | None | Tie |
| **Errors** | `{type:'error', id, error}` | JSON-RPC error objects, incl. a typed `auth_required` | **ACP**, slightly |

## 3. What was awkward or missing

**Tool calls lose their name.** ACP models a tool call as a *human title* plus a coarse `kind`.
`bridge/src/adapters/kimiflare.ts` hands the UI `bash`/`read`/`edit`; over ACP the closest honest
value is `kind`, so the adapter sets `name: kind` and parks the title in `state.title`. Our
`tool-meta.ts` icon lookup substring-matches, so `execute`/`read`/`edit`/`search`/`fetch` still land
on the right icon — but `primaryArg(name, input)` and `resultKind(name)` are now working off a
different vocabulary than every other harness. Any v2 contract must keep a machine tool name.

**Patch-shaped updates are a footgun.** `ToolCallUpdate` makes everything but `toolCallId` optional,
and "absent" means "unchanged". The first version of the adapter merged with a plain spread, which
let the update's absent (`undefined`) `title`/`kind`/`rawInput` **erase** what the initial `tool_call`
had established. The test caught it; the fix skips `undefined` on merge. The bespoke RPC's
whole-object `tool.result` cannot have this class of bug.

**Blocking permission requests fit our topology badly.** In ACP the agent's tool loop is parked
inside a JSON-RPC request until we answer, and the spec has no timeout or agent-side cancel. Our
permission cards travel bridge → DO → ~1.2s poll → browser → back. If the container sleeps or the
user closes the tab mid-request, the agent parks forever with no protocol-level escape. The adapter
therefore answers `{outcome:'cancelled'}` for every outstanding request on `abort()`, and answers
`-32601` to the `fs/*` and `terminal/*` methods we decline — but that is us papering over a real
mismatch. KimiFlare's fire-and-forget `permission.request` event is *safer* for a hosted host.

**`usage_update` looks like usage and isn't.** It is `{size, used, cost?}` — a context meter. Issue
#8 wants "KimiFlare usage summing"; over ACP the only token numbers come from
`PromptResponse.usage`, which is `@experimental`, arrives once at end of turn (no live meter), and
carries no cost from this peer. That is a straight regression against the RPC's per-call `usage`
event.

**Half of ACP's surface is for local editors.** `fs/read_text_file`, `fs/write_text_file`,
`terminal/*`, `document/did*`, `nes/*` all assume the *client* owns the files and the shell. In our
topology the agent already lives in the sandbox with the files. We decline them via
`clientCapabilities` and reject the calls. Not harmful, but a large slice of the protocol is dead
weight for a hosted host.

**The protocol is moving.** `@agentclientprotocol/sdk` has published 49 versions from 0.4.5 to
1.3.0; kimiflare pins `^0.21.0`. Two fields the pilot leans on directly — `PromptResponse.usage`
(the only real token counts) and `ContentChunk.messageId` (the only thing separating two assistant
messages in a turn) — are annotated `**UNSTABLE** … may be removed or changed at any point` in the
types themselves, as are `providers/*` and `nes/*`.

**Nothing to talk to.** `kimiflare-acp` is unpublished and `kimiflare@0.99.0` ships no ACP bin, so
flipping `KIMIFLARE_VIA_ACP` today requires publishing (or vendoring) that package into the sandbox
image first. This is why the pilot is validated against a scripted peer
(`test/kimiflare-acp.test.ts`) rather than a live process.

## 4. What ACP got unambiguously right

1. **The turn is a request/response.** `session/prompt` resolving *is* the end of the turn. Compare
   `bridge/src/adapters/kimiflare.ts`, which latches a `finished` flag and races an `ok` ack against
   `session.end`, or `pi.ts`, which hand-rolls `createPiRpc` for correlation. ACP deletes that code.
2. **Capabilities are negotiated, not guessed.** `src/shared/harness-caps.ts` opens by calling itself
   "ACP-shaped fields … the static Option A from the capability audit; **v2 lets adapters override
   these values at /start**". ACP's `initialize` + `session/new` responses *are* that override, in a
   shape someone else maintains.
3. **Modes are data.** The agent names its own modes with ids, labels and descriptions; the client
   renders what it is told. Our mode switcher currently hard-codes Plan|Build|Auto and disables the
   ones a static table says are missing.
4. **Permission options are data.** The agent decides what choices exist and what they are called,
   per request — instead of every harness being squeezed into `once`/`always`/`reject`.

## 5. Verdict

**Keep ACP as one adapter among many. Do not make it the v2 wire contract. Do adopt its vocabulary.**

Against adopting it as *the* contract:

- **Steering has no expression in ACP.** pi's live `steer` is a real capability we ship
  (`HarnessCaps.steering: 'live'`), and there is no ACP method, notification or field that could
  carry it. A contract that cannot express a capability we already have is not a superset.
- **Usage and cost regress** to an experimental end-of-turn field plus a context meter, which
  directly blocks the cost work in issue #8.
- **Resume is capability-gated and this peer has none**, which would break
  `BridgeSession.ensureModel`'s restart-with-resume — the mechanism every harness relies on for a
  mid-session model switch.
- **It is churning**, and the exact fields the mapping depends on are the ones marked unstable.

For keeping it as an adapter: it costs one file. The next time we meet a harness that speaks ACP
natively — the protocol's anchor is Zed's agent panel, which is exactly why kimiflare grew an ACP
wrapper (`CHANGELOG.md`: "add Zed Agent Panel (ACP) integration") — this adapter is the cheapest
possible way to add it. No new RPC dialect to reverse-engineer, and the mapping is already written
and tested.

**The part worth promoting to v2 is the capability manifest, not the transport.** `HarnessAdapter`
should grow an optional `capabilities(): HarnessCaps` that `start()` resolves and `/start` returns,
replacing the static `HARNESS_CAPS` table — the ACP adapter fills it from `initialize` +
`session/new` for free, the RPC adapters keep returning today's constants, and the UI stops
hard-coding what each harness can do. Similarly, `NormPermission` should carry the agent's option
list (id + kind + label) instead of forcing `once`/`always`/`reject`, and `NormToolState` should keep
both a machine `name` and a human `title`. Those three changes capture most of ACP's value and cost
nothing in steering, usage or resume.
