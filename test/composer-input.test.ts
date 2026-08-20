import { describe, expect, it } from 'vitest'
import {
  clearMentionToken,
  detectTrigger,
  insertMention,
  mergeDynamicCommands,
  parseBangCommand,
  parseSlashInvocation,
} from '../src/shared/composer-input'

describe("'!' shell parsing", () => {
  it('takes everything after the bang as the command', () => {
    expect(parseBangCommand('!ls -la', true)).toEqual({ command: 'ls -la' })
    expect(parseBangCommand('! npm test ', true)).toEqual({ command: 'npm test' })
    // A second bang is part of the command (history expansion), not a second prefix.
    expect(parseBangCommand('!!', true)).toEqual({ command: '!' })
  })

  it('keeps multi-line commands whole', () => {
    expect(parseBangCommand('!for f in *; do\n  echo $f\ndone', true)).toEqual({
      command: 'for f in *; do\n  echo $f\ndone',
    })
  })

  it('is inert when the harness has no shell pipe', () => {
    expect(parseBangCommand('!ls', false)).toBeNull()
  })

  it('ignores a bang that is not the very first character', () => {
    expect(parseBangCommand(' !important', true)).toBeNull()
    expect(parseBangCommand('this is urgent!', true)).toBeNull()
    expect(parseBangCommand('do not use != here', true)).toBeNull()
  })

  it('needs something to run', () => {
    expect(parseBangCommand('!', true)).toBeNull()
    expect(parseBangCommand('!   ', true)).toBeNull()
    expect(parseBangCommand('', true)).toBeNull()
  })
})

describe('slash command arguments', () => {
  const known = ['review', 'deploy', 'mcp:search', 'shell']

  it('splits the name from its arguments', () => {
    expect(parseSlashInvocation('/review src/foo.ts please', known)).toEqual({
      name: 'review',
      args: 'src/foo.ts please',
    })
    expect(parseSlashInvocation('/deploy', known)).toEqual({ name: 'deploy', args: '' })
    expect(parseSlashInvocation('/deploy    ', known)).toEqual({ name: 'deploy', args: '' })
  })

  it('supports the separators OpenCode uses for mcp/skill command names', () => {
    expect(parseSlashInvocation('/mcp:search widgets', known)).toEqual({
      name: 'mcp:search',
      args: 'widgets',
    })
  })

  it('keeps multi-line arguments (a folded paste becomes $ARGUMENTS)', () => {
    expect(parseSlashInvocation('/review\n```ts\nconst a = 1\n```', known)).toEqual({
      name: 'review',
      args: '```ts\nconst a = 1\n```',
    })
  })

  it('leaves prose alone when the name is not one the harness advertises', () => {
    expect(parseSlashInvocation('/new idea for the sidebar', known)).toBeNull()
    expect(parseSlashInvocation('/unknown', known)).toBeNull()
    // A bare path is not a command invocation either.
    expect(parseSlashInvocation('/usr/local/bin is on PATH', known)).toBeNull()
  })

  it('only fires when the slash starts the message', () => {
    expect(parseSlashInvocation('please /review this', known)).toBeNull()
  })
})

describe('popover triggers', () => {
  const both = { commands: true, mentions: true }

  it("opens commands only for a bare leading '/'", () => {
    expect(detectTrigger('/rev', 4, both)).toEqual({ kind: 'command', query: 'rev' })
    expect(detectTrigger('/', 1, both)).toEqual({ kind: 'command', query: '' })
    // Once arguments start, the command menu is done.
    expect(detectTrigger('/review foo', 11, both)).toBeNull()
    expect(detectTrigger('hi /review', 10, both)).toBeNull()
  })

  it("opens mentions for '@' at a word boundary", () => {
    expect(detectTrigger('@pl', 3, both)).toEqual({ kind: 'mention', query: 'pl' })
    expect(detectTrigger('look at @src/a', 14, both)).toEqual({ kind: 'mention', query: 'src/a' })
    expect(detectTrigger('mail me at foo@bar', 18, both)).toBeNull()
  })

  it('respects what the host actually offers', () => {
    expect(detectTrigger('/rev', 4, { commands: false, mentions: true })).toBeNull()
    expect(detectTrigger('@pl', 3, { commands: true, mentions: false })).toBeNull()
  })

  it('reads the token before the CARET, not the end of the text', () => {
    expect(detectTrigger('@pl and more', 3, both)).toEqual({ kind: 'mention', query: 'pl' })
  })
})

describe('mention insertion', () => {
  it('replaces the typed token with the picked file path', () => {
    expect(insertMention('look at @sr', 11, 'src/app.ts')).toEqual({
      text: 'look at @src/app.ts ',
      caret: 20,
    })
  })

  it('keeps whatever followed the caret', () => {
    const edit = insertMention('see @sr later', 7, 'src/a.ts')
    expect(edit.text).toBe('see @src/a.ts  later')
    expect(edit.text.slice(edit.caret)).toBe(' later')
  })

  it('removes the token entirely when an agent was picked', () => {
    expect(clearMentionToken('run @pl', 7)).toEqual({ text: 'run ', caret: 4 })
    const edit = clearMentionToken('run @pl now', 7)
    expect(edit.text).toBe('run  now')
    expect(edit.caret).toBe(4)
  })

  it('is a no-op when there is no token before the caret', () => {
    expect(clearMentionToken('plain text', 10)).toEqual({ text: 'plain text', caret: 10 })
  })
})

describe('dynamic command merge', () => {
  const base = [{ id: 'compact' }, { id: 'undo' }, { id: 'shell' }]

  it('keeps harness commands that do not collide with the static menu', () => {
    expect(
      mergeDynamicCommands(base, [
        { name: 'review', description: 'code review' },
        { name: 'deploy' },
      ]),
    ).toEqual([{ name: 'review', description: 'code review' }, { name: 'deploy' }])
  })

  it('never lets a harness command shadow a built-in id', () => {
    expect(mergeDynamicCommands(base, [{ name: 'compact' }, { name: 'shell' }])).toEqual([])
  })

  it('collapses duplicates and drops nameless rows, preserving first-seen order', () => {
    expect(
      mergeDynamicCommands(base, [{ name: 'b' }, { name: 'a' }, { name: 'b' }, { name: '' }]),
    ).toEqual([{ name: 'b' }, { name: 'a' }])
  })

  it('is empty when the harness advertises nothing', () => {
    expect(mergeDynamicCommands(base, [])).toEqual([])
  })
})
