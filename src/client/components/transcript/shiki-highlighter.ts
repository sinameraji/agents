import { useEffect, useState } from 'react'

// Minimal shape we use — shiki itself is dynamically imported so it stays out of the main bundle.
type Highlighter = { codeToHtml: (code: string, opts: { lang: string; theme: string }) => string }

/**
 * Lazy singleton Shiki highlighter. The bundle is loaded once, on first use, and
 * shared by every code block / diff on the page.
 */

const THEMES = ['github-dark', 'github-light'] as const
const LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'python',
  'bash',
  'html',
  'css',
  'markdown',
  'diff',
  'go',
  'rust',
] as const

const LANG_SET = new Set<string>(LANGS)

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  htm: 'html',
  md: 'markdown',
  rs: 'rust',
  golang: 'go',
  patch: 'diff',
  text: 'text',
  plaintext: 'text',
  txt: 'text',
}

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ getSingletonHighlighter }) =>
      getSingletonHighlighter({ themes: [...THEMES], langs: [...LANGS] }) as unknown as Promise<Highlighter>,
    )
  }
  return highlighterPromise
}

/** Normalize an arbitrary language hint to one of our loaded langs, or 'text'. */
function normalizeLang(lang?: string): string {
  if (!lang) return 'text'
  const lower = lang.toLowerCase().trim()
  if (LANG_SET.has(lower)) return lower
  const alias = ALIASES[lower]
  if (alias && (alias === 'text' || LANG_SET.has(alias))) return alias
  return 'text'
}

/** True when the document is in dark mode (light mode toggles a `.light` class on <html>). */
export function isDark(): boolean {
  if (typeof document === 'undefined') return true
  return !document.documentElement.classList.contains('light')
}

/** Reactively track the current theme; re-renders when the `.light` class flips. */
export function useIsDark(): boolean {
  const [dark, setDark] = useState<boolean>(() => isDark())
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    setDark(isDark())
    return () => observer.disconnect()
  }, [])
  return dark
}

/** Highlight `code` to a `<pre>…</pre>` HTML string. Falls back to 'text' for unknown langs. */
export async function highlight(code: string, lang: string | undefined, dark: boolean): Promise<string> {
  const highlighter = await getHighlighter()
  return highlighter.codeToHtml(code, {
    lang: normalizeLang(lang),
    theme: dark ? 'github-dark' : 'github-light',
  })
}
