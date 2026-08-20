import type { NormPart, NormTurn } from './agent'

/**
 * Pure client-side transcript export: NormTurn[] -> clean markdown. No DOM, no fetch, so it is
 * unit-testable and the download can be built entirely in the browser from the already-loaded
 * transcript. Reasoning parts are deliberately omitted (exports share outcomes, not
 * chain-of-thought); tool output is truncated with an explicit marker.
 */
export interface TranscriptExportInput {
  title: string
  harness?: string
  model?: string
  /** Export timestamp; defaults to now. Rendered as YYYY-MM-DD. */
  date?: Date
  turns: NormTurn[]
}

const MAX_TOOL_OUTPUT_LINES = 30
const MAX_TOOL_OUTPUT_CHARS = 2000

/** Cap text at N lines / M chars, appending an explicit truncation marker when cut. */
export function truncateOutput(
  text: string,
  maxLines = MAX_TOOL_OUTPUT_LINES,
  maxChars = MAX_TOOL_OUTPUT_CHARS,
): string {
  let out = text
  let truncated = false
  const lines = out.split('\n')
  if (lines.length > maxLines) {
    out = lines.slice(0, maxLines).join('\n')
    truncated = true
  }
  if (out.length > maxChars) {
    out = out.slice(0, maxChars)
    truncated = true
  }
  return truncated ? `${out.trimEnd()}\n... (output truncated)` : out
}

/** A fence longer than any backtick run inside the content, so embedded ``` can never break out. */
function fenceFor(content: string): string {
  const longest = content.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0
  return '`'.repeat(Math.max(3, longest + 1))
}

function fenced(content: string): string {
  const f = fenceFor(content)
  return `${f}\n${content}\n${f}`
}

/** One-line command/arguments summary for a tool call. */
function toolCommand(part: Extract<NormPart, { kind: 'tool' }>): string {
  const input = part.state.input ?? {}
  const cmd = input.command
  if (typeof cmd === 'string' && cmd.trim()) return cmd.trim()
  if (part.state.title) return part.state.title
  const keys = Object.keys(input)
  if (!keys.length) return ''
  const summary = JSON.stringify(input)
  return summary.length > 200 ? `${summary.slice(0, 200)}...` : summary
}

/** Render one part, or null when it has nothing to say in an export. */
function renderPart(part: NormPart): string | null {
  switch (part.kind) {
    case 'text':
      return part.text.trim() || null
    case 'reasoning':
      return null // omitted on purpose
    case 'tool': {
      const sections: string[] = []
      const cmd = toolCommand(part)
      if (cmd) sections.push(`$ ${cmd}`)
      if (part.state.output?.trim()) sections.push(truncateOutput(part.state.output.trim()))
      if (part.state.error?.trim()) sections.push(`error: ${part.state.error.trim()}`)
      const header = `**Tool: ${part.name}**`
      return sections.length ? `${header}\n\n${fenced(sections.join('\n\n'))}` : header
    }
    case 'terminal': {
      const sections: string[] = []
      if (part.command) sections.push(`$ ${part.command}`)
      if (part.output?.trim()) sections.push(truncateOutput(part.output.trim()))
      if (typeof part.exitCode === 'number' && part.exitCode !== 0) sections.push(`(exit ${part.exitCode})`)
      return sections.length ? fenced(sections.join('\n')) : null
    }
    case 'diff': {
      const files = part.files.map((f) => {
        const counts = [
          f.additions != null ? `+${f.additions}` : null,
          f.deletions != null ? `-${f.deletions}` : null,
        ]
          .filter(Boolean)
          .join(' ')
        return `- ${f.path}${counts ? ` (${counts})` : ''}`
      })
      return files.length ? `**Changes**\n\n${files.join('\n')}` : null
    }
    case 'todos':
      return part.todos.map((t) => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.content}`).join('\n') || null
    case 'error':
      return `> Error (${part.name}): ${part.message}`
    case 'preview':
      return `Preview server detected on port ${part.port}.`
    case 'subtask':
      return `**Subtask (${part.agent})**${part.description ? `: ${part.description}` : ''}`
    case 'step':
      return null // per-step usage is aggregated in the footer
  }
}

/** Build the full markdown document for a session transcript. */
export function transcriptToMarkdown(input: TranscriptExportInput): string {
  const date = input.date ?? new Date()
  const lines: string[] = [`# ${input.title}`, '']
  if (input.harness) lines.push(`- Harness: ${input.harness}`)
  if (input.model) lines.push(`- Model: ${input.model}`)
  lines.push(`- Exported: ${date.toISOString().slice(0, 10)}`, '')

  for (const turn of input.turns) {
    const rendered = turn.parts.map(renderPart).filter((s): s is string => s !== null)
    if (!rendered.length) continue
    lines.push(turn.role === 'user' ? '## User' : '## Agent', '')
    lines.push(rendered.join('\n\n'), '')
  }

  // Usage totals: each assistant turn carries its own per-turn usage; sum them.
  let tokensIn = 0
  let tokensOut = 0
  let costUsd = 0
  for (const turn of input.turns) {
    if (turn.role !== 'assistant' || !turn.usage) continue
    tokensIn += turn.usage.input
    tokensOut += turn.usage.output + (turn.usage.reasoning ?? 0)
    costUsd += turn.usage.cost ?? 0
  }
  lines.push(
    '---',
    '',
    `Totals: ${input.turns.length} turns, ${tokensIn} tokens in, ${tokensOut} tokens out, $${costUsd.toFixed(2)}`,
  )
  return lines.join('\n') + '\n'
}
