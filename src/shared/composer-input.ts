/**
 * Pure parsing for what the user typed into the composer, shared so the DO and the browser agree
 * on the same rules (and so it is testable without a DOM).
 *
 * Three prefixes are special:
 *  - `!cmd`  → a direct shell command (OpenCode session.shell), gated on caps.bangShell.
 *  - `/name` → a slash command; arguments after the name survive and reach OpenCode's
 *              session.command as `$ARGUMENTS`.
 *  - `@tok`  → the mention popover (workspace files + named agents).
 */

/** A composer line that should run as a shell command instead of a prompt. */
export interface BangCommand {
  command: string
}

/**
 * `!ls -la` → `{ command: 'ls -la' }`. Returns null when the harness has no shell pipe, when the
 * line does not start with '!', or when nothing follows the '!'. Leading whitespace defeats the
 * prefix on purpose: " !important" stays an ordinary prompt.
 */
export function parseBangCommand(text: string, enabled: boolean): BangCommand | null {
  if (!enabled) return null
  if (!text.startsWith('!')) return null
  const command = text.slice(1).trim()
  return command ? { command } : null
}

/** A slash command plus everything the user typed after it. */
export interface SlashInvocation {
  name: string
  /** Raw remainder, whitespace-trimmed at both ends. '' when the user typed no arguments. */
  args: string
}

/**
 * `/review src/foo.ts please` → `{ name: 'review', args: 'src/foo.ts please' }`, but only when
 * `name` is one the harness actually advertises: an unknown `/thing` is just text and must reach
 * the model unchanged. Command names may carry the separators OpenCode uses for MCP/skill
 * commands (`:`, `.`, `-`, `_`).
 */
export function parseSlashInvocation(text: string, known: readonly string[]): SlashInvocation | null {
  const m = /^\/([A-Za-z0-9][\w.:-]*)(?:[ \t]+([\s\S]*))?$/.exec(text.trim())
  if (!m) return null
  const name = m[1]
  if (!known.includes(name)) return null
  return { name, args: (m[2] ?? '').trim() }
}

/** What the '@' / '/' popover is currently offering. */
export type MenuTrigger = { kind: 'mention' | 'command'; query: string }

/**
 * Which popover (if any) the caret position implies. '/' only triggers at the very start of the
 * message and only while it is still one bare word; '@' triggers at a word boundary anywhere.
 */
export function detectTrigger(
  value: string,
  caret: number,
  opts: { commands: boolean; mentions: boolean },
): MenuTrigger | null {
  const upToCaret = value.slice(0, caret)
  if (opts.commands && /^\/[A-Za-z0-9-]*$/.test(upToCaret)) {
    return { kind: 'command', query: upToCaret.slice(1).toLowerCase() }
  }
  if (!opts.mentions) return null
  const m = upToCaret.match(/(?:^|\s)@([\w./-]*)$/)
  return m ? { kind: 'mention', query: m[1].toLowerCase() } : null
}

/** The text + caret after resolving a mention token: `insert` replaces the '@query' being typed. */
export interface MentionEdit {
  text: string
  caret: number
}

/**
 * Replace the '@query' immediately before the caret with `@<value> `. Used when the picked item is
 * a workspace file, whose path belongs in the prompt text.
 */
export function insertMention(text: string, caret: number, value: string): MentionEdit {
  const upToCaret = text.slice(0, caret)
  const replaced = upToCaret.replace(/@([\w./-]*)$/, `@${value} `)
  return { text: replaced + text.slice(caret), caret: replaced.length }
}

/**
 * Drop the '@query' immediately before the caret without putting anything back. Used when the
 * picked item is an AGENT: the choice rides the prompt's `agent` field and shows as a chip, so
 * leaving '@name' in the text would send it to the model twice.
 */
export function clearMentionToken(text: string, caret: number): MentionEdit {
  const upToCaret = text.slice(0, caret)
  const stripped = upToCaret.replace(/@([\w./-]*)$/, '')
  return { text: stripped + text.slice(caret), caret: stripped.length }
}
