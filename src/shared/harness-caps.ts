/**
 * Harness capability manifest — the single source of truth for what each harness can actually do
 * through Dreamweav's pipe (ACP-shaped fields). The UI reads this to HIDE structural absences
 * (never disable-with-tooltip for things that can never work). This is the static "Option A" from
 * the capability audit; v2 lets adapters override these values at /start.
 */
import type { Harness, SessionMode } from './protocol'

export interface HarnessCaps {
  /** Session modes with real behavior behind them; the UI only renders these. */
  modes: SessionMode[]
  /** 'live' = the harness accepts steering mid-turn; 'stop-and-send' = we abort and re-prompt. */
  steering: 'live' | 'stop-and-send'
  /** How a mid-session model pick lands: on the next prompt, via a harness restart, or not at all. */
  modelSwitch: 'per-prompt' | 'restart' | 'none'
  /** Built-in slash-command ids the harness supports (resolved by the chat-view command registry). */
  commands: string[]
  /** Emits interactive permission asks the user must answer. */
  permissions: boolean
  /** Emits subtask/sub-agent parts (drives the sub-agents panel). */
  subagents: boolean
  /** What a prompt may carry beyond text. */
  promptCapabilities: {
    /** Image input reaches the model. No harness supports this through our pipe yet. */
    image: boolean
    /** Generic file attachments (uploaded to R2, copied into /workspace/uploads by the DO) —
     *  harness-agnostic, so true everywhere; image is the model-input axis and stays per-harness. */
    fileAttach: boolean
  }
  /** Emits reasoning/thinking parts into the transcript. */
  reasoning: boolean
}

export const HARNESS_CAPS: Record<Harness, HarnessCaps> = {
  opencode: {
    // plan → OpenCode's plan agent per prompt; 'auto' has no distinct behavior in our pipe.
    modes: ['plan', 'build'],
    steering: 'stop-and-send',
    // setModel marks ocModelDirty → a fresh OpenCode process next turn picks up the new model.
    modelSwitch: 'restart',
    commands: ['compact', 'undo', 'redo', 'init', 'diff', 'share', 'unshare'],
    // permission.asked events, plus the permission.list poll during turns.
    permissions: true,
    // The only harness that emits subtask/agent parts (opencode-map.ts).
    subagents: true,
    promptCapabilities: { image: false, fileAttach: true },
    reasoning: true,
  },
  pi: {
    // pi ignores mode entirely (spawned with --no-approve; the sandbox is the boundary).
    modes: ['build'],
    // pi's RPC natively accepts steer while a turn runs (the bridge still emulates for now).
    steering: 'live',
    // --model is fixed at spawn; a new pick only lands when the bridge process restarts.
    modelSwitch: 'none',
    commands: ['compact', 'stats', 'export'],
    // No tool-permission asks (--no-approve); only rare extension UI dialogs surface as cards.
    permissions: false,
    subagents: false,
    promptCapabilities: { image: false, fileAttach: true },
    // The adapter maps text deltas only; thinking output is not surfaced.
    reasoning: false,
  },
  kimiflare: {
    // Mode is sent per prompt as plan / edit / auto — all three are real.
    modes: ['plan', 'build', 'auto'],
    steering: 'stop-and-send',
    // Model is set once at new_session; no mid-session switch path.
    modelSwitch: 'none',
    commands: [],
    // permission.request events, resolved via resolve_permission.
    permissions: true,
    subagents: false,
    promptCapabilities: { image: false, fileAttach: true },
    // message.reasoning deltas stream as reasoning parts.
    reasoning: true,
  },
  aisdk: {
    // plan gates the write tools; 'auto' is identical to build (there are no approvals to skip).
    modes: ['plan', 'build'],
    steering: 'stop-and-send',
    // Provider baseURL + model are captured at /start; no mid-session switch path.
    modelSwitch: 'none',
    commands: ['compact'],
    // No interactive approvals; plan mode blocks writes instead of asking.
    permissions: false,
    subagents: false,
    promptCapabilities: { image: false, fileAttach: true },
    reasoning: false,
  },
  cfagent: {
    // plan gates the write tools; 'auto' is identical to build (there are no approvals to skip).
    modes: ['plan', 'build'],
    steering: 'stop-and-send',
    // The loop runs in the DO and reads the session's model every turn.
    modelSwitch: 'per-prompt',
    commands: ['compact'],
    permissions: false,
    subagents: false,
    promptCapabilities: { image: false, fileAttach: true },
    reasoning: false,
  },
}

/** Conservative fallback while session meta is loading: show nothing we cannot vouch for. */
const NO_CAPS: HarnessCaps = {
  modes: ['build'],
  steering: 'stop-and-send',
  modelSwitch: 'none',
  commands: [],
  permissions: false,
  subagents: false,
  promptCapabilities: { image: false, fileAttach: true },
  reasoning: false,
}

/** Caps for a harness, or the conservative fallback when the harness is not known yet. */
export function harnessCaps(harness: Harness | undefined): HarnessCaps {
  return harness ? HARNESS_CAPS[harness] : NO_CAPS
}
