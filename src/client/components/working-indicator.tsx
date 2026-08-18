import { Sparkles } from 'lucide-react'

/** Shown while the agent is booting/thinking and hasn't produced a message yet. */
export function WorkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex gap-3">
      <div
        className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-primary/30 bg-primary/15 text-primary"
        aria-hidden
      >
        <Sparkles className="size-3.5" />
      </div>
      <div className="flex min-h-7 flex-col justify-center gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex gap-1" aria-hidden>
            <span className="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-primary/70" />
          </span>
          <span>{label}</span>
        </div>
      </div>
    </div>
  )
}
