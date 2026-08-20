/**
 * Harness capability manifest — the single source of truth for what each harness can actually do
 * through Dreamweav's pipe (ACP-shaped fields). The UI HIDES most structural absences; MODES are
 * the exception: the switcher always renders Plan|Build|Auto and DISABLES the unsupported ones
 * with a tooltip, because "this harness has no Plan" is information the user needs at the moment
 * of reaching for it. This is the static "Option A" from the capability audit; v2 lets adapters
 * override these values at /start.
 */
import type { Harness, SessionMode } from './protocol'

export interface HarnessCaps {
  /** Session modes with real behavior behind them; the switcher disables the rest. */
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
    /** The HARNESS pipe can put image input in front of the model. This is only the harness
     *  axis: the selected model must also accept images (shared/vision.ts modelAcceptsImages);
     *  the DO ANDs both before inlining an image into a turn. */
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
    // plan → the plan agent per prompt (+ ask permissions); build → permission preset asking on
    // edit/bash; auto → allow-everything preset. Presets apply via ocConfigDirty restart.
    modes: ['plan', 'build', 'auto'],
    steering: 'stop-and-send',
    // setModel/setMode mark ocConfigDirty → a fresh OpenCode process next turn picks it up.
    modelSwitch: 'restart',
    commands: ['compact', 'undo', 'redo', 'init', 'diff', 'share', 'unshare'],
    // permission.asked events, plus the permission.list poll during turns.
    permissions: true,
    // The only harness that emits subtask/agent parts (opencode-map.ts).
    subagents: true,
    // image: promptAsync FilePartInput with a file:// URL; the server base64s it for the model.
    promptCapabilities: { image: true, fileAttach: true },
    reasoning: true,
  },
  pi: {
    // pi ignores mode entirely (spawned with --no-approve; the sandbox is the boundary).
    modes: ['build'],
    // pi's RPC natively accepts steer while a turn runs (the bridge still emulates for now).
    steering: 'live',
    // --model is fixed at spawn; a new pick only lands when the bridge process restarts.
    modelSwitch: 'restart',
    commands: ['compact', 'stats', 'export'],
    // No tool-permission asks (--no-approve); only rare extension UI dialogs surface as cards.
    permissions: false,
    subagents: false,
    // image: pi's RPC prompt pipe carries text only — images stay workspace files.
    promptCapabilities: { image: false, fileAttach: true },
    // The adapter maps text deltas only; thinking output is not surfaced.
    reasoning: false,
  },
  kimiflare: {
    // Mode is sent per prompt as plan / edit / auto — all three are real.
    modes: ['plan', 'build', 'auto'],
    steering: 'stop-and-send',
    // Model is set once at new_session; no mid-session switch path.
    modelSwitch: 'restart',
    commands: [],
    // permission.request events, resolved via resolve_permission.
    permissions: true,
    subagents: false,
    // image: the kimiflare prompt pipe is text-only (options.images is not wired through) —
    // images stay workspace files.
    promptCapabilities: { image: false, fileAttach: true },
    // message.reasoning deltas stream as reasoning parts.
    reasoning: true,
  },
  aisdk: {
    // plan blocks the write tools; build asks before mutations; auto runs everything unasked.
    modes: ['plan', 'build', 'auto'],
    steering: 'stop-and-send',
    // Provider baseURL + model are captured at /start; no mid-session switch path.
    modelSwitch: 'restart',
    commands: ['compact'],
    // Build mode's ask-before-mutate surfaces as permission cards (gateMutation in the adapter).
    permissions: true,
    subagents: false,
    // image: data URLs ride POST /prompt into a multimodal AI SDK user message.
    promptCapabilities: { image: true, fileAttach: true },
    reasoning: false,
  },
  cfagent: {
    // plan blocks the write tools; build asks before mutations; auto runs everything unasked.
    modes: ['plan', 'build', 'auto'],
    steering: 'stop-and-send',
    // The loop runs in the DO and reads the session's model every turn.
    modelSwitch: 'per-prompt',
    commands: ['compact'],
    // Build mode's ask-before-mutate surfaces as permission cards (askPermission in the loop).
    permissions: true,
    subagents: false,
    // image: the DO builds the multimodal AI SDK user message itself (shares the ai package).
    promptCapabilities: { image: true, fileAttach: true },
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
