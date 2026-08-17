'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Download, FileText, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { PastedBlock as PastedBlockType } from '~shared/protocol'
import { Button } from '@/components/ui/button'

export function PastedBlock({
  block,
  onRemove,
  className,
}: {
  block: PastedBlockType
  onRemove?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <span
        className={cn(
          'group inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/60 py-1 pr-1 pl-2 text-sm text-foreground/90 transition-colors hover:border-primary/40 hover:bg-muted',
          className,
        )}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer truncate font-mono text-xs outline-none focus-visible:underline"
          title="Click to expand"
        >
          [Pasted {block.lines} {block.lines === 1 ? 'line' : 'lines'}]
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove pasted content"
            className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </span>

      {open && <PastedPreview block={block} onClose={() => setOpen(false)} />}
    </>
  )
}

function PastedPreview({ block, onClose }: { block: PastedBlockType; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const lines = block.content.split('\n')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable in some sandboxes */
    }
  }

  const download = () => {
    const blob = new Blob([block.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pasted.${block.language ?? 'txt'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Pasted ${block.lines} lines`}
    >
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm"
      />
      <div className="relative flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">Pasted content</span>
              <span className="font-mono text-xs text-muted-foreground">
                {block.lines} lines · {block.chars.toLocaleString()} chars
                {block.language ? ` · ${block.language}` : ''}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy">
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={download} aria-label="Download">
              <Download className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
        </header>
        <div className="scrollbar-thin overflow-auto">
          <table className="w-full border-collapse font-mono text-[13px] leading-6">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="align-top">
                  <td className="w-px py-0 pr-4 pl-4 text-right text-muted-foreground/50 select-none">
                    {i + 1}
                  </td>
                  <td className="py-0 pr-4 whitespace-pre text-foreground/90">
                    {line === '' ? ' ' : line}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
