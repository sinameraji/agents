import { useState } from 'react'
import { Check, ChevronRight, Loader2, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { NormPart, NormToolState } from '~shared/agent'
import { langFromPath, primaryArg, resultKind, toolMeta } from '../tool-meta'
import { CodeBlock } from '../code-block'
import { TerminalBlock } from './terminal-block'

type ToolPartData = Extract<NormPart, { kind: 'tool' }>

const PREVIEW_MAX_LINES = 200

function looksLikeDiff(text: string): boolean {
  return /^(diff --git |@@ |--- |\+\+\+ |index )/m.test(text)
}

function StatusChip({ status }: { status: NormToolState['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
    case 'completed':
      return <Check className="size-3 shrink-0 text-success/80" />
    case 'error':
      return <X className="size-3 shrink-0 text-destructive" />
    default:
      return <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
  }
}

/** A truncated plain-text panel with a show more/less toggle. */
function TruncatedPre({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = text.split('\n')
  const overflow = lines.length > PREVIEW_MAX_LINES
  const shown = overflow && !expanded ? lines.slice(0, PREVIEW_MAX_LINES) : lines
  const hidden = lines.length - shown.length
  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/40">
      <pre className="scrollbar-thin max-h-80 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap text-foreground/85">
        {shown.join('\n')}
      </pre>
      {overflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? 'Show less' : `Show ${hidden} more line${hidden === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}

function ToolBody({ part }: { part: ToolPartData }) {
  const { name, state } = part
  const arg = primaryArg(name, state.input)
  const output = state.output
  const kind = resultKind(name)

  if (state.status === 'error' && state.error) {
    return (
      <pre className="scrollbar-thin max-h-48 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">
        {state.error}
      </pre>
    )
  }

  if (!output) {
    // The command/primary arg is already in the header, never dump raw input JSON as a body.
    return (
      <p className="px-1 text-xs text-muted-foreground">
        {state.status === 'running' || state.status === 'pending' ? 'Running…' : 'No output'}
      </p>
    )
  }

  switch (kind) {
    case 'terminal':
      return <TerminalBlock output={output} command={arg} />
    case 'diff':
      return looksLikeDiff(output) ? (
        <CodeBlock code={output} lang="diff" maxHeight={420} />
      ) : (
        <TruncatedPre text={output} />
      )
    case 'code':
      return <CodeBlock code={output} lang={langFromPath(arg)} maxHeight={420} />
    default:
      return <TruncatedPre text={output} />
  }
}

/** A single tool call: one compact row (icon · name · arg · status), expandable on click.
 *  Errors open themselves; everything else stays a quiet one-liner in the action log. */
export function ToolCard({ part }: { part: ToolPartData }) {
  const { name, state } = part
  const { icon: Icon, label } = toolMeta(name)
  const arg = primaryArg(name, state.input)

  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? state.status === 'error'

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOverride(!open)}
        className="group/tool flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-muted/50"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
        <span className="shrink-0 text-[13px] font-medium text-foreground/80">{label}</span>
        {arg && (
          <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">{arg}</code>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          <StatusChip status={state.status} />
          <ChevronRight
            className={cn(
              'size-3 text-muted-foreground/40 opacity-0 transition-all group-hover/tool:opacity-100',
              open && 'rotate-90 opacity-100',
            )}
          />
        </span>
      </button>

      {open && (
        <div className="mt-1 mb-0.5 ml-[13px] border-l-2 border-border pl-3">
          <ToolBody part={part} />
        </div>
      )}
    </div>
  )
}
