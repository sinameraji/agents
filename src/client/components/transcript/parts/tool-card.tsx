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

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0)
  return line ? line.trim() : ''
}

function StatusChip({ status }: { status: NormToolState['status'] }) {
  switch (status) {
    case 'running':
      return (
        <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
          <Loader2 className="size-3.5 animate-spin" />
          running
        </span>
      )
    case 'completed':
      return <Check className="size-3.5 shrink-0 text-success" />
    case 'error':
      return <X className="size-3.5 shrink-0 text-destructive" />
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

/** A single tool call: a collapsible header with live status and a polymorphic result body. */
export function ToolCard({ part }: { part: ToolPartData }) {
  const { name, state } = part
  const { icon: Icon, label } = toolMeta(name)
  const arg = primaryArg(name, state.input)

  const auto = state.status === 'error' || state.status === 'running'
  const [override, setOverride] = useState<boolean | null>(null)
  const open = override ?? auto

  const preview =
    !open && state.status === 'completed' && state.output ? firstLine(state.output) : ''

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/60">
      <button
        type="button"
        onClick={() => setOverride(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-sm font-medium">{label}</span>
        {arg && (
          <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">{arg}</code>
        )}
        {state.title && state.title !== arg && (
          <span className="hidden min-w-0 truncate font-mono text-xs text-muted-foreground/70 sm:inline">
            {state.title}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <StatusChip status={state.status} />
          <ChevronRight
            className={cn(
              'size-3.5 text-muted-foreground/60 transition-transform',
              open && 'rotate-90',
            )}
          />
        </span>
      </button>

      {preview && (
        <div className="truncate border-t border-border px-2.5 py-1 font-mono text-xs text-muted-foreground/70">
          {preview}
        </div>
      )}

      {open && (
        <div className="border-t border-border p-2">
          <ToolBody part={part} />
        </div>
      )}
    </div>
  )
}
