import { describe, expect, it } from 'vitest'
import { stripImagesFromHistory, userMessageWithImages } from '../src/server/harness/cfagent'

describe('cfagent userMessageWithImages', () => {
  it('stays a plain string message without images', () => {
    expect(userMessageWithImages('hello')).toEqual({ role: 'user', content: 'hello' })
    expect(userMessageWithImages('hello', [])).toEqual({ role: 'user', content: 'hello' })
  })

  it('builds a multimodal user message: text part first, then image file parts', () => {
    const msg = userMessageWithImages('what does this show?', [
      { name: 'graph.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
    ])
    expect(msg).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what does this show?' },
        { type: 'file', data: 'data:image/png;base64,iVBORw0KGgo=', mediaType: 'image/png', filename: 'graph.png' },
      ],
    })
  })
})

describe('cfagent stripImagesFromHistory', () => {
  it('replaces user image parts with a text marker and leaves everything else alone', () => {
    const history = [
      { role: 'user' as const, content: 'plain' },
      userMessageWithImages('look', [{ name: 'a.png', dataUrl: 'data:image/png;base64,AAAA' }]),
      { role: 'assistant' as const, content: 'I looked.' },
    ]
    const stripped = stripImagesFromHistory(history)
    expect(stripped[0]).toEqual({ role: 'user', content: 'plain' })
    expect(stripped[2]).toEqual({ role: 'assistant', content: 'I looked.' })
    expect(stripped[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'text', text: '[image attached earlier: a.png (see ./uploads/)]' },
      ],
    })
    // no base64 survives into what gets persisted
    expect(JSON.stringify(stripped)).not.toContain('base64')
  })
})
