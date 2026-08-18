import { useEffect, useState } from 'react'
import { Send, ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { NormPermission, PermissionReply } from '~shared/agent'

/** An inline (non-modal) approval prompt for a tool the agent wants to run. */
export function PermissionCard({
  permission,
  onReply,
}: {
  permission: NormPermission
  onReply: (reply: PermissionReply, note?: string) => void
}) {
  const [denying, setDenying] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      if (typing || denying) return
      if (e.key === '1') onReply('once')
      else if (e.key === '2') onReply('always')
      else if (e.key === '3') setDenying(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [denying, onReply])

  const input = permission.input
  const hasInput = input && Object.keys(input).length > 0

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-start gap-2.5">
        <div
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary/15 text-primary"
          aria-hidden
        >
          <ShieldAlert className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{permission.title}</p>
          {hasInput && (
            <pre className="scrollbar-thin mt-1.5 max-h-40 overflow-auto rounded-md border border-border bg-card/60 px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {JSON.stringify(input, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {denying ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Tell the agent what to do instead…"
            rows={2}
            className="scrollbar-thin w-full resize-y rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDenying(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-1"
              onClick={() => onReply('reject', note.trim() || undefined)}
            >
              <Send className="size-3.5" />
              Send
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => onReply('once')}>
            Allow once
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onReply('always')}>
            Allow always
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDenying(true)}>
            Deny
          </Button>
        </div>
      )}
    </div>
  )
}
