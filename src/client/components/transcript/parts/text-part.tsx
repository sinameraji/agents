import type { NormPart } from '~shared/agent'
import { Markdown } from '../markdown'

type TextPartData = Extract<NormPart, { kind: 'text' }>

/** A block of assistant prose. Shows a blinking cursor while it is still streaming. */
export function TextPart({ part }: { part: TextPartData }) {
  return (
    <div className="min-w-0">
      <Markdown text={part.text} />
      {part.streaming && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse rounded-full bg-primary align-middle"
        />
      )}
    </div>
  )
}
