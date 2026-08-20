import { useState } from 'react'
import { ChevronRight, FileDiff } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { NormDiffFile } from '~shared/agent'
import { DiffView } from '../diff-view'

/**
 * Renders changed files. A file with a unified-diff `patch` expands to a GitHub-style DiffView (tinted rows);
 * otherwise we show the per-file +/- summary row.
 */
export function DiffBlock({ files }: { files: NormDiffFile[] }) {
  if (!files.length) return null
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card/60 p-2">
      {files.map((f, i) => (
        <DiffFile key={`${f.path}:${i}`} file={f} />
      ))}
    </div>
  )
}

function DiffFile({ file }: { file: NormDiffFile }) {
  const [open, setOpen] = useState(false)
  const hasPatch = !!file.patch && file.patch.trim().length > 0

  return (
    <div className="flex flex-col">
      <button
        type="button"
        disabled={!hasPatch}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 rounded-md px-1 py-0.5 text-sm',
          hasPatch && 'hover:bg-muted',
        )}
      >
        {hasPatch ? (
          <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        ) : (
          <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-mono text-xs text-foreground/90">{file.path}</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-xs">
          {file.additions != null && <span className="text-success">+{file.additions}</span>}
          {file.deletions != null && <span className="text-destructive">-{file.deletions}</span>}
        </span>
      </button>
      {open && hasPatch && (
        <div className="mt-1">
          <DiffView diff={file.patch!} maxHeight={420} />
        </div>
      )}
    </div>
  )
}
