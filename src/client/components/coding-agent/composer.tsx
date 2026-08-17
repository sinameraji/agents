'use client'

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { ArrowUp, AtSign, Paperclip } from 'lucide-react'

import { cn } from '@/lib/utils'
import { countLines } from '~shared/format'
import type { PastedBlock } from '~shared/protocol'
import { Button } from '@/components/ui/button'
import { PastedBlock as PastedChip } from './pasted-block'

/** Paste is collapsed into a chip when it is multi-line and sizable. */
const LINE_THRESHOLD = 4
const CHAR_THRESHOLD = 240

let pasteSeq = 0

export function Composer({
  onSend,
  sessionName,
}: {
  onSend: (text: string, pasted: PastedBlock[]) => void
  sessionName: string
}) {
  const [text, setText] = useState('')
  const [pasted, setPasted] = useState<PastedBlock[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const detectLanguage = (content: string): string | undefined => {
    if (/^\s*(import |export |const |function |=>)/m.test(content)) return 'ts'
    if (/^\s*(def |class |import )/m.test(content)) return 'py'
    if (/(FAIL|PASS|Error:|Traceback)/.test(content)) return 'log'
    return undefined
  }

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const clip = e.clipboardData.getData('text')
    const lines = countLines(clip)
    if (lines >= LINE_THRESHOLD || clip.length >= CHAR_THRESHOLD) {
      e.preventDefault()
      pasteSeq += 1
      setPasted((prev) => [
        ...prev,
        {
          id: `paste-${Date.now()}-${pasteSeq}`,
          language: detectLanguage(clip),
          lines,
          chars: clip.length,
          content: clip,
        },
      ])
    }
  }

  const canSend = text.trim().length > 0 || pasted.length > 0

  const submit = () => {
    if (!canSend) return
    onSend(text.trim(), pasted)
    setText('')
    setPasted([])
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm transition-colors focus-within:border-primary/50">
          {pasted.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1 pt-1">
              {pasted.map((block) => (
                <PastedChip
                  key={block.id}
                  block={block}
                  onRemove={() => setPasted((prev) => prev.filter((b) => b.id !== block.id))}
                />
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={`Message the agent working on "${sessionName}"…`}
            className="scrollbar-thin max-h-48 min-h-11 w-full resize-none bg-transparent px-2 py-1 text-[0.95rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
          />

          <div className="flex items-center gap-1 px-1">
            <Button variant="ghost" size="icon-sm" aria-label="Attach file">
              <Paperclip className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Mention a file">
              <AtSign className="size-4" />
            </Button>
            <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">
              Paste large snippets — they collapse into a chip
            </span>
            <Button
              size="icon"
              className={cn('ml-auto rounded-lg', !canSend && 'opacity-50')}
              disabled={!canSend}
              onClick={submit}
              aria-label="Send message"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>
        <p className="mt-1.5 px-1 text-center text-[0.7rem] text-muted-foreground/70">
          Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </div>
  )
}
