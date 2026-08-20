import { useMemo } from 'react'

import { cn } from '@/lib/utils'

/**
 * A unified-diff renderer styled like GitHub / Cursor: full-width tinted rows (soft green for
 * additions, soft red for deletions), sticky line-number gutters, and a +/- sign column, instead
 * of Shiki's plain colored diff text. Parses a raw `git diff` string — no external diff lib (we
 * deliberately avoid @git-diff-view, whose bundled CSS ships a second Tailwind preflight that
 * clobbers the app's global styles). Tint classes (dv-add/dv-del/…) live in app.css and derive
 * from the theme tokens, so they track light/dark automatically.
 */
type Row =
  | { kind: 'file'; text: string }
  | { kind: 'hunk'; text: string }
  | { kind: 'meta'; text: string }
  | { kind: 'add' | 'del' | 'context'; oldNo?: number; newNo?: number; text: string }

const HUNK_RE = /^@@+ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@+(.*)$/

function parseDiff(diff: string): Row[] {
  const rows: Row[] = []
  let oldNo = 0
  let newNo = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      // "diff --git a/path b/path" → show just the (new) path as a file header.
      const m = line.match(/ b\/(.+)$/)
      rows.push({ kind: 'file', text: m ? m[1] : line.replace(/^diff --git /, '') })
      continue
    }
    // Redundant git envelope lines — the file header + hunk headers already convey this.
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('similarity ') ||
      line.startsWith('rename ') ||
      line.startsWith('copy ')
    ) {
      continue
    }
    const hunk = line.match(HUNK_RE)
    if (hunk) {
      oldNo = parseInt(hunk[1], 10)
      newNo = parseInt(hunk[2], 10)
      rows.push({ kind: 'hunk', text: hunk[3].trim() })
      continue
    }
    if (line.startsWith('\\')) {
      rows.push({ kind: 'meta', text: line.replace(/^\\ /, '') }) // "No newline at end of file"
      continue
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', newNo, text: line.slice(1) })
      newNo++
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'del', oldNo, text: line.slice(1) })
      oldNo++
    } else {
      // Context (leading space) or a stray blank line inside the diff body.
      rows.push({ kind: 'context', oldNo, newNo, text: line.startsWith(' ') ? line.slice(1) : line })
      oldNo++
      newNo++
    }
  }
  // Trailing empty row from the final newline adds nothing — drop it.
  if (rows.length && rows[rows.length - 1].kind === 'context' && (rows[rows.length - 1] as { text: string }).text === '') {
    rows.pop()
  }
  return rows
}

const GUTTER = 'sticky shrink-0 select-none px-1.5 text-right text-[0.68rem] tabular-nums text-muted-foreground/60'

function Line({ row }: { row: Extract<Row, { kind: 'add' | 'del' | 'context' }> }) {
  const add = row.kind === 'add'
  const del = row.kind === 'del'
  return (
    <div className={cn('flex', add && 'dv-add', del && 'dv-del')}>
      <span className={cn(GUTTER, 'left-0 w-9', add ? 'dv-add-num' : del ? 'dv-del-num' : 'dv-ctx-num')}>
        {row.oldNo ?? ''}
      </span>
      <span className={cn(GUTTER, 'left-9 w-9', add ? 'dv-add-num' : del ? 'dv-del-num' : 'dv-ctx-num')}>
        {row.newNo ?? ''}
      </span>
      <span
        className={cn(
          'w-4 shrink-0 select-none text-center',
          add ? 'text-success' : del ? 'text-destructive' : 'text-transparent',
        )}
      >
        {add ? '+' : del ? '-' : ' '}
      </span>
      <span className="grow whitespace-pre pr-3 text-foreground/90">{row.text || ' '}</span>
    </div>
  )
}

export function DiffView({ diff, maxHeight, className }: { diff: string; maxHeight?: number; className?: string }) {
  const rows = useMemo(() => parseDiff(diff), [diff])
  if (!rows.length) return null

  return (
    <div
      className={cn(
        'scrollbar-thin overflow-auto rounded-md border border-border bg-card/40 font-mono text-xs leading-[1.55]',
        className,
      )}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <div className="w-max min-w-full">
        {rows.map((row, i) => {
          if (row.kind === 'file') {
            return (
              <div
                key={i}
                className="sticky left-0 border-b border-border bg-muted/60 px-3 py-1 text-[0.7rem] font-medium text-foreground/80"
              >
                {row.text}
              </div>
            )
          }
          if (row.kind === 'hunk') {
            return (
              <div key={i} className="dv-hunk px-3 py-0.5 text-[0.7rem] text-muted-foreground">
                <span className="mr-2 select-none opacity-50">@@</span>
                {row.text}
              </div>
            )
          }
          if (row.kind === 'meta') {
            return (
              <div key={i} className="px-3 py-0.5 text-[0.68rem] italic text-muted-foreground/70">
                {row.text}
              </div>
            )
          }
          return <Line key={i} row={row} />
        })}
      </div>
    </div>
  )
}
