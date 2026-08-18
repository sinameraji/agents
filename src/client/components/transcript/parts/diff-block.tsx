import { Component, type ReactNode, useState } from 'react'
import { ChevronRight, FileDiff } from 'lucide-react'
import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'

import { cn } from '@/lib/utils'
import type { NormDiffFile } from '~shared/agent'
import { CodeBlock } from '../code-block'
import { useIsDark } from '../shiki-highlighter'

/** Catches any render error thrown by the diff library and shows a fallback instead. */
class DiffErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function looksLikeDiff(patch: string): boolean {
  return /^(diff --git |@@ |--- |\+\+\+ |index )/m.test(patch)
}

function DiffFileRow({ file }: { file: NormDiffFile }) {
  const dark = useIsDark()
  const hasPatch = typeof file.patch === 'string' && file.patch.length > 0
  const [open, setOpen] = useState(false)

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card/60">
      <button
        type="button"
        onClick={() => hasPatch && setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-1.5 text-left',
          hasPatch && 'transition-colors hover:bg-muted/50',
        )}
      >
        {hasPatch ? (
          <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        ) : (
          <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">
          {file.path}
        </span>
        {typeof file.additions === 'number' && (
          <span className="shrink-0 font-mono text-xs text-success">+{file.additions}</span>
        )}
        {typeof file.deletions === 'number' && (
          <span className="shrink-0 font-mono text-xs text-destructive">-{file.deletions}</span>
        )}
      </button>
      {hasPatch && open && file.patch && (
        <div className="border-t border-border">
          {looksLikeDiff(file.patch) ? (
            <DiffErrorBoundary
              fallback={<CodeBlock code={file.patch} lang="diff" maxHeight={420} className="rounded-none border-0" />}
            >
              <div className="scrollbar-thin overflow-auto text-xs [&_.diff-line-num]:select-none">
                <DiffView
                  data={{
                    hunks: [file.patch],
                    oldFile: { fileName: file.path },
                    newFile: { fileName: file.path },
                  }}
                  diffViewMode={DiffModeEnum.Unified}
                  diffViewWrap
                  diffViewHighlight={false}
                  diffViewTheme={dark ? 'dark' : 'light'}
                  diffViewFontSize={12}
                />
              </div>
            </DiffErrorBoundary>
          ) : (
            <CodeBlock code={file.patch} lang="diff" maxHeight={420} className="rounded-none border-0" />
          )}
        </div>
      )}
    </div>
  )
}

/** Renders a set of changed files, each collapsible to its unified diff. */
export function DiffBlock({ files }: { files: NormDiffFile[] }) {
  if (files.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {files.map((file, i) => (
        <DiffFileRow key={`${file.path}-${i}`} file={file} />
      ))}
    </div>
  )
}
