import { useEffect, useRef, useState } from 'react'
import type { NormPart } from '~shared/agent'
import { Markdown } from '../markdown'

type TextPartData = Extract<NormPart, { kind: 'text' }>

/**
 * Assistant prose. While streaming, new text is revealed with a smooth typewriter effect so
 * chunked transports (the container harnesses are polled) still FEEL token-streamed. When the
 * part stops streaming (or on history hydration) it snaps to the full text.
 */
export function TextPart({ part }: { part: TextPartData }) {
  const [shown, setShown] = useState(() => (part.streaming ? 0 : part.text.length))
  const shownRef = useRef(shown)
  shownRef.current = shown

  useEffect(() => {
    if (!part.streaming) {
      setShown(part.text.length)
      return
    }
    if (shownRef.current >= part.text.length) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const target = part.text.length
      const remaining = target - shownRef.current
      if (remaining <= 0) return
      // Reveal the backlog over ~400ms, with a floor so short chunks still animate.
      const speed = Math.max(40, remaining / 0.4) // chars per second
      const step = Math.max(1, Math.round(((now - last) / 1000) * speed))
      last = now
      setShown((n) => Math.min(target, n + step))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [part.text, part.streaming])

  const visible = part.streaming ? part.text.slice(0, shown) : part.text

  return (
    <div className="min-w-0">
      <Markdown text={visible} />
      {part.streaming && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse rounded-full bg-primary align-middle"
        />
      )}
    </div>
  )
}
