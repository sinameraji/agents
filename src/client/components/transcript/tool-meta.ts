import {
  FilePlus,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export interface ToolMeta {
  icon: LucideIcon
  label: string
}

/** Map a raw tool `name` (harness-specific, any casing) to an icon + friendly label. */
export function toolMeta(name: string): ToolMeta {
  const n = name.toLowerCase()
  if (n.includes('read') || n.includes('cat') || n.includes('view')) {
    return { icon: FileText, label: 'Read' }
  }
  if (n.includes('write') || n.includes('create')) {
    return { icon: FilePlus, label: 'Write' }
  }
  if (
    n.includes('edit') ||
    n.includes('patch') ||
    n.includes('replace') ||
    n.includes('apply')
  ) {
    return { icon: Pencil, label: 'Edit' }
  }
  if (
    n.includes('bash') ||
    n.includes('shell') ||
    n.includes('terminal') ||
    n.includes('exec') ||
    n.includes('command')
  ) {
    return { icon: SquareTerminal, label: 'Terminal' }
  }
  if (n.includes('grep')) {
    return { icon: Search, label: 'Search' }
  }
  if (n.includes('glob')) {
    return { icon: FolderTree, label: 'Glob' }
  }
  if (n.includes('list') || n === 'ls' || n.includes('tree') || n.includes('dir')) {
    return { icon: FolderTree, label: 'List' }
  }
  if (n.includes('web') || n.includes('fetch') || n.includes('url') || n.includes('http')) {
    return { icon: Globe, label: 'Fetch' }
  }
  if (n.includes('task') || n.includes('agent') || n.includes('spawn')) {
    return { icon: GitBranch, label: 'Subagent' }
  }
  return { icon: Wrench, label: prettifyName(name) }
}

function prettifyName(name: string): string {
  const cleaned = name.replace(/[_-]+/g, ' ').trim()
  if (!cleaned) return name
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

/** Pull the single most relevant argument to show in a tool header. */
export function primaryArg(name: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined
  const order =
    resultKind(name) === 'terminal'
      ? ['command', 'cmd', 'script', 'filePath', 'path', 'pattern', 'query', 'url']
      : ['filePath', 'path', 'file', 'command', 'cmd', 'pattern', 'query', 'url']
  for (const key of order) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

export type ResultKind = 'terminal' | 'diff' | 'code' | 'matches' | 'generic'

/** How a tool's result should be rendered. */
export function resultKind(name: string): ResultKind {
  const n = name.toLowerCase()
  if (
    n.includes('bash') ||
    n.includes('shell') ||
    n.includes('terminal') ||
    n.includes('exec') ||
    n.includes('command')
  ) {
    return 'terminal'
  }
  if (
    n.includes('edit') ||
    n.includes('write') ||
    n.includes('patch') ||
    n.includes('replace') ||
    n.includes('create') ||
    n.includes('apply')
  ) {
    return 'diff'
  }
  if (n.includes('read') || n.includes('cat') || n.includes('view')) {
    return 'code'
  }
  if (
    n.includes('grep') ||
    n.includes('glob') ||
    n.includes('list') ||
    n.includes('search') ||
    n.includes('find') ||
    n === 'ls'
  ) {
    return 'matches'
  }
  return 'generic'
}

/** Infer a Shiki language id from a file path's extension. */
export function langFromPath(path?: string): string | undefined {
  if (!path) return undefined
  const base = path.split(/[?#]/)[0]
  const ext = base.includes('.') ? base.split('.').pop()?.toLowerCase() : undefined
  if (!ext) return undefined
  const map: Record<string, string> = {
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'jsx',
    json: 'json',
    jsonc: 'json',
    py: 'python',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    html: 'html',
    htm: 'html',
    css: 'css',
    md: 'markdown',
    markdown: 'markdown',
    go: 'go',
    rs: 'rust',
    diff: 'diff',
    patch: 'diff',
  }
  return map[ext]
}
