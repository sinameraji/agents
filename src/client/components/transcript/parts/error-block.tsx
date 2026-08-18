import { AlertTriangle, RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** An always-expanded error card. Optionally offers a retry action. */
export function ErrorBlock({
  name,
  message,
  onRetry,
}: {
  name: string
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="text-sm font-medium">{name || 'Error'}</span>
        {onRetry && (
          <Button
            variant="destructive"
            size="xs"
            className="ml-auto gap-1"
            onClick={onRetry}
          >
            <RotateCw className="size-3" />
            Retry
          </Button>
        )}
      </div>
      {message && (
        <pre className="scrollbar-thin mt-2 max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap">
          {message}
        </pre>
      )}
    </div>
  )
}
