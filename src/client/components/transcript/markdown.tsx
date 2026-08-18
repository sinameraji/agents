import type { ComponentPropsWithoutRef } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'
import { CodeBlock } from './code-block'

type CodeProps = ComponentPropsWithoutRef<'code'> & ExtraProps
type PreProps = ComponentPropsWithoutRef<'pre'> & ExtraProps
type AnchorProps = ComponentPropsWithoutRef<'a'> & ExtraProps

const components: Components = {
  code({ className, children }: CodeProps) {
    const match = /language-([\w-]+)/.exec(className ?? '')
    const raw = String(children ?? '')
    const isBlock = Boolean(match) || raw.includes('\n')
    if (isBlock) {
      return <CodeBlock code={raw.replace(/\n$/, '')} lang={match?.[1]} maxHeight={420} />
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground/90">
        {children}
      </code>
    )
  },
  // Fenced code blocks are handled by `code`; unwrap the default <pre> so we don't
  // nest a block-level CodeBlock inside a <pre>.
  pre({ children }: PreProps) {
    return <>{children}</>
  },
  a({ children, href }: AnchorProps) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-primary underline underline-offset-2 hover:opacity-80"
      >
        {children}
      </a>
    )
  },
}

const PROSE = cn(
  'text-[0.95rem] leading-relaxed text-foreground/90',
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-base [&_h1]:font-semibold',
  '[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-[0.95rem] [&_h2]:font-semibold',
  '[&_h3]:mt-2.5 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5 [&_li>p]:my-0',
  '[&_strong]:font-semibold [&_em]:italic',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_hr]:my-3 [&_hr]:border-border',
  '[&_table]:my-2 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-sm',
  '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
)

/** Render markdown as compact, themed prose. Fenced code is highlighted via CodeBlock. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn(PROSE, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
