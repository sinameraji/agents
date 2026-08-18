'use client'

import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { ArrowUp, AtSign, File as FileIcon, Loader2, Paperclip, SquareSlash, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { countLines } from '~shared/format'
import type { PastedBlock } from '~shared/protocol'
import { uploadFiles, type UploadedAttachment } from '@/lib/upload'
import { Button } from '@/components/ui/button'
import { PastedBlock as PastedChip } from './pasted-block'

/** Paste is collapsed into a chip when it is multi-line and sizable. */
const LINE_THRESHOLD = 4
const CHAR_THRESHOLD = 240

let pasteSeq = 0

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface SlashCommand {
  id: string
  label: string
  hint: string
  run: () => void
}

export function Composer({
  onSend,
  sessionName,
  extras,
  commands,
  listFiles,
}: {
  onSend: (text: string, pasted: PastedBlock[], attachments: UploadedAttachment[]) => void
  sessionName: string
  extras?: React.ReactNode
  commands?: SlashCommand[]
  listFiles?: () => Promise<string[]>
}) {
  const [text, setText] = useState('')
  const [pasted, setPasted] = useState<PastedBlock[]>([])
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState<{ kind: 'mention' | 'command'; query: string } | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [fileList, setFileList] = useState<string[] | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  /** '@token' before the caret opens the file-mention menu; a leading '/' opens commands. */
  const detectTrigger = (value: string, caret: number): { kind: 'mention' | 'command'; query: string } | null => {
    const upToCaret = value.slice(0, caret)
    if (/^\/[a-zA-Z0-9-]*$/.test(upToCaret) && commands?.length) {
      return { kind: 'command', query: upToCaret.slice(1).toLowerCase() }
    }
    const m = upToCaret.match(/(?:^|\s)@([\w./-]*)$/)
    if (m && listFiles) return { kind: 'mention', query: m[1].toLowerCase() }
    return null
  }

  const refreshMenu = (value: string, caret: number) => {
    const trigger = detectTrigger(value, caret)
    setMenu(trigger)
    if (trigger) setMenuIndex(0)
    if (trigger?.kind === 'mention' && fileList === null && listFiles) {
      setFileList([])
      void listFiles().then(setFileList).catch(() => setFileList([]))
    }
  }

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

  const uploadSelected = async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      const uploaded = await uploadFiles(files)
      setAttachments((prev) => [...prev, ...uploaded])
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    void uploadSelected(files)
  }

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragging(false)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    void uploadSelected(Array.from(e.dataTransfer.files))
  }

  const canSend = text.trim().length > 0 || pasted.length > 0 || attachments.length > 0

  const submit = () => {
    if (!canSend) return
    onSend(text.trim(), pasted, attachments)
    setText('')
    setPasted([])
    setAttachments([])
    setUploadError(null)
  }

  const menuItems: { id: string; label: string; hint?: string }[] = (() => {
    if (!menu) return []
    if (menu.kind === 'command') {
      return (commands ?? [])
        .filter((c) => c.id.toLowerCase().startsWith(menu.query))
        .slice(0, 8)
        .map((c) => ({ id: c.id, label: `/${c.id}`, hint: c.hint }))
    }
    const files = fileList ?? []
    const q = menu.query
    const starts = files.filter((f) => f.toLowerCase().startsWith(q))
    const includes = q ? files.filter((f) => !f.toLowerCase().startsWith(q) && f.toLowerCase().includes(q)) : []
    return [...starts, ...includes].slice(0, 8).map((f) => ({ id: f, label: f }))
  })()

  const selectMenuItem = (item: { id: string }) => {
    if (!menu) return
    const ta = textareaRef.current
    if (menu.kind === 'command') {
      const cmd = (commands ?? []).find((c) => c.id === item.id)
      setText('')
      setMenu(null)
      cmd?.run()
      ta?.focus()
      return
    }
    const caret = ta?.selectionStart ?? text.length
    const upToCaret = text.slice(0, caret)
    const replaced = upToCaret.replace(/@([\w./-]*)$/, `@${item.id} `)
    const next = replaced + text.slice(caret)
    setText(next)
    setMenu(null)
    requestAnimationFrame(() => {
      ta?.focus()
      ta?.setSelectionRange(replaced.length, replaced.length)
    })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
    if (menu && menuItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenuIndex((i) => (i + 1) % menuItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenuIndex((i) => (i - 1 + menuItems.length) % menuItems.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMenuItem(menuItems[Math.min(menuIndex, menuItems.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenu(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-border bg-background/80 px-4 py-3 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl">
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            'relative flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm transition-colors focus-within:border-primary/50',
            dragging && 'border-primary bg-primary/5',
          )}
        >
          {menu && menuItems.length > 0 && (
            <div className="absolute bottom-[calc(100%+0.5rem)] left-2 z-30 w-96 max-w-[90vw] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl">
              {menu.kind === 'mention' && fileList !== null && fileList.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading files…</div>
              )}
              {menuItems.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectMenuItem(item)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                    i === menuIndex ? 'bg-muted text-foreground' : 'text-foreground/90 hover:bg-muted',
                  )}
                >
                  {menu.kind === 'command' ? (
                    <SquareSlash className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-mono text-xs">{item.label}</span>
                  {item.hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.hint}</span>}
                </button>
              ))}
            </div>
          )}

          {(pasted.length > 0 || attachments.length > 0) && (
            <div className="flex flex-wrap gap-2 px-1 pt-1">
              {pasted.map((block) => (
                <PastedChip
                  key={block.id}
                  block={block}
                  onRemove={() => setPasted((prev) => prev.filter((b) => b.id !== block.id))}
                />
              ))}
              {attachments.map((file) => (
                <span
                  key={file.key}
                  className="group inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/60 py-1 pr-1 pl-2 text-sm text-foreground/90 transition-colors hover:border-primary/40 hover:bg-muted"
                >
                  <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs" title={file.name}>
                    {file.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatSize(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((f) => f.key !== file.key))
                    }
                    aria-label={`Remove ${file.name}`}
                    className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              refreshMenu(e.target.value, e.target.selectionStart ?? e.target.value.length)
            }}
            onPaste={handlePaste}
            onBlur={() => setTimeout(() => setMenu(null), 150)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={`Message the agent working on "${sessionName}"…`}
            className="scrollbar-thin max-h-48 min-h-11 w-full resize-none bg-transparent px-2 py-1 text-[0.95rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
          />

          <div className="flex items-center gap-1 px-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={handleFileInput}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={uploading ? 'Uploading files' : 'Attach file'}
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Paperclip className="size-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Mention a file"
              onClick={() => {
                const ta = textareaRef.current
                const caret = ta?.selectionStart ?? text.length
                const needsSpace = caret > 0 && !/\s$/.test(text.slice(0, caret))
                const next = text.slice(0, caret) + (needsSpace ? ' @' : '@') + text.slice(caret)
                setText(next)
                const newCaret = caret + (needsSpace ? 2 : 1)
                refreshMenu(next, newCaret)
                requestAnimationFrame(() => {
                  ta?.focus()
                  ta?.setSelectionRange(newCaret, newCaret)
                })
              }}
            >
              <AtSign className="size-4" />
            </Button>
            {extras}
            {uploadError && <span className="ml-1 truncate text-xs text-destructive">{uploadError}</span>}
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
