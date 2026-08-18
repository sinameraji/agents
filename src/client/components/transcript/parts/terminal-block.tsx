import { useState } from 'react'

import { cn } from '@/lib/utils'

const MAX_LINES = 400

/** A monospace terminal panel: `$ command`, an exit-code chip, and scrollable output. */
export function TerminalBlock({
  command,
  output,
  exitCode,
}: {
  command?: string
  output?: string
  exitCode?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const text = output ?? ''
  const lines = text.length > 0 ? text.split('\n') : []
  const overflow = lines.length > MAX_LINES
  const shown = overflow && !expanded ? lines.slice(0, MAX_LINES) : lines
  const hidden = lines.length - shown.length

  const hasExit = typeof exitCode === 'number'
  const ok = exitCode === 0

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      {(command || hasExit) && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          {command && (
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">
              <span className="text-muted-foreground select-none">$ </span>
              {command}
            </code>
          )}
          {hasExit && (
            <span
              className={cn(
                'ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.7rem]',
                ok ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
              )}
            >
              exit {exitCode}
            </span>
          )}
        </div>
      )}
      {shown.length > 0 ? (
        <pre className="scrollbar-thin max-h-80 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap text-foreground/85">
          {shown.join('\n')}
        </pre>
      ) : (
        <div className="px-3 py-2 font-mono text-xs text-muted-foreground">No output</div>
      )}
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
