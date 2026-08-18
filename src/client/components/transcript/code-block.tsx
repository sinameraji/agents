import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'
import { highlight, useIsDark } from './shiki-highlighter'

/**
 * Syntax-highlighted code, rendered with Shiki. Highlighting is async, so we show a
 * plain `<pre>` first and swap in the highlighted HTML once it resolves. Re-highlights
 * when the code, language, or theme changes.
 */
export function CodeBlock({
  code,
  lang,
  maxHeight,
  className,
}: {
  code: string
  lang?: string
  maxHeight?: number
  className?: string
}) {
  const dark = useIsDark()
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    highlight(code, lang, dark)
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, lang, dark])

  return (
    <div
      className={cn(
        'scrollbar-thin overflow-auto rounded-md border border-border bg-muted/40 text-xs',
        '[&_pre]:m-0 [&_pre]:p-3 [&_pre]:!bg-transparent [&_code]:!bg-transparent [&_code]:font-mono',
        className,
      )}
      style={maxHeight ? { maxHeight } : undefined}
    >
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="m-0 p-3 font-mono text-xs whitespace-pre text-foreground/90">{code}</pre>
      )}
    </div>
  )
}
