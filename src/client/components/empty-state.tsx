import { Plus, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmptyState({ onNew, hasSessions }: { onNew: () => void; hasSessions: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Terminal className="size-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Agents.</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasSessions
              ? 'Pick a session on the left, or start a new one.'
              : 'Point a coding agent at a repo and work from your browser. Everything runs in an isolated Cloudflare sandbox on your own keys.'}
          </p>
        </div>
        <Button onClick={onNew} className="gap-2">
          <Plus className="size-4" />
          New session
        </Button>
      </div>
    </div>
  )
}
