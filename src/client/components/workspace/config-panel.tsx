'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { AlertCircle, Check, FileText, LoaderCircle, Plus, Server, Sparkles, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { SessionApi } from '@/hooks/use-session'
import { Button } from '@/components/ui/button'

type Section = 'agents-md' | 'mcp' | 'agents'

const OPENCODE_SCHEMA = 'https://opencode.ai/config.json'
const AGENTS_MD_PATH = '/workspace/AGENTS.md'
const OPENCODE_JSON_PATH = '/workspace/opencode.json'

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary/50'
const textareaClass =
  'scrollbar-thin w-full resize-y rounded-md border border-border bg-card px-2.5 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none'

export function ConfigPanel({ session }: { session: SessionApi }) {
  const [section, setSection] = useState<Section>('agents-md')

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-0.5 border-b border-border p-2">
        <SubTab
          active={section === 'agents-md'}
          onClick={() => setSection('agents-md')}
          icon={<FileText className="size-3.5" />}
          label="AGENTS.md"
        />
        <SubTab
          active={section === 'mcp'}
          onClick={() => setSection('mcp')}
          icon={<Server className="size-3.5" />}
          label="MCP"
        />
        <SubTab
          active={section === 'agents'}
          onClick={() => setSection('agents')}
          icon={<Sparkles className="size-3.5" />}
          label="Agents"
        />
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
        {section === 'agents-md' && <AgentsMdSection session={session} />}
        {section === 'mcp' && <McpSection session={session} />}
        {section === 'agents' && <AgentsSection session={session} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* AGENTS.md                                                           */
/* ------------------------------------------------------------------ */

function AgentsMdSection({ session }: { session: SessionApi }) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(false)
    session
      .readFile(AGENTS_MD_PATH)
      .then((text) => {
        if (!alive) return
        setValue(text ?? '')
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setLoadError(true)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [session])

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const ok = await session.writeFile(AGENTS_MD_PATH, value)
      if (ok) {
        setSaved(true)
        window.setTimeout(() => setSaved(false), 2000)
      } else {
        setError('Could not save AGENTS.md.')
      }
    } catch {
      setError('Could not save AGENTS.md.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingRow />

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading
        title="AGENTS.md"
        hint="Freeform instructions the agent reads for every task in this workspace."
      />
      {loadError && (
        <Note tone="error">Could not read the existing file — you can still write a new one.</Note>
      )}
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={14}
        spellCheck={false}
        placeholder="Describe your project, conventions, and anything the agent should always keep in mind…"
        className={textareaClass}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          Save
        </Button>
        {saved && <SavedTag />}
        {error && <ErrorTag>{error}</ErrorTag>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* MCP servers                                                         */
/* ------------------------------------------------------------------ */

interface McpLocal {
  type: 'local'
  command: string[]
  environment?: Record<string, string>
}
interface McpRemote {
  type: 'remote'
  url: string
}
type McpServer = McpLocal | McpRemote

interface OpencodeConfig {
  $schema?: string
  mcp?: Record<string, McpServer>
  [key: string]: unknown
}

function mcpSummary(srv: McpServer): string {
  if (srv.type === 'remote') return srv.url ?? ''
  return Array.isArray(srv.command) ? srv.command.join(' ') : ''
}

function McpSection({ session }: { session: SessionApi }) {
  const [config, setConfig] = useState<OpencodeConfig>({})
  const [loading, setLoading] = useState(true)
  const [parseError, setParseError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [serverType, setServerType] = useState<'local' | 'remote'>('local')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setParseError(false)
    session
      .readFile(OPENCODE_JSON_PATH)
      .then((text) => {
        if (!alive) return
        if (text) {
          try {
            const parsed = JSON.parse(text) as OpencodeConfig
            setConfig(parsed && typeof parsed === 'object' ? parsed : {})
          } catch {
            setParseError(true)
            setConfig({})
          }
        } else {
          setConfig({})
        }
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setConfig({})
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [session])

  const servers = config.mcp ?? {}
  const serverEntries = Object.entries(servers)

  async function persist(nextConfig: OpencodeConfig) {
    setSaving(true)
    setError(null)
    setSaved(false)
    const withSchema: OpencodeConfig = { ...nextConfig, $schema: OPENCODE_SCHEMA }
    try {
      const ok = await session.writeFile(OPENCODE_JSON_PATH, JSON.stringify(withSchema, null, 2))
      if (ok) {
        setConfig(withSchema)
        setSaved(true)
        window.setTimeout(() => setSaved(false), 2000)
      } else {
        setError('Could not save opencode.json.')
      }
    } catch {
      setError('Could not save opencode.json.')
    } finally {
      setSaving(false)
    }
  }

  function addServer() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the server a name.')
      return
    }
    let server: McpServer
    if (serverType === 'local') {
      const parts = command.trim().split(/\s+/).filter(Boolean)
      if (parts.length === 0) {
        setError('Enter a command for the local server.')
        return
      }
      server = { type: 'local', command: parts, environment: {} }
    } else {
      const u = url.trim()
      if (!u) {
        setError('Enter a URL for the remote server.')
        return
      }
      server = { type: 'remote', url: u }
    }
    const nextConfig: OpencodeConfig = { ...config, mcp: { ...servers, [trimmed]: server } }
    setName('')
    setCommand('')
    setUrl('')
    void persist(nextConfig)
  }

  function removeServer(key: string) {
    const nextMcp = { ...servers }
    delete nextMcp[key]
    void persist({ ...config, mcp: nextMcp })
  }

  if (loading) return <LoadingRow />

  return (
    <div className="flex flex-col gap-3">
      <SectionHeading
        title="MCP servers"
        hint="Model Context Protocol servers the agent can call. Stored in opencode.json."
      />
      {parseError && (
        <Note tone="error">
          opencode.json was missing or invalid — starting from an empty config. Saving will
          overwrite it.
        </Note>
      )}

      {serverEntries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No MCP servers configured yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {serverEntries.map(([key, srv]) => (
            <li
              key={key}
              className="flex items-start gap-2 rounded-lg border border-border bg-card px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{key}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
                    {srv.type}
                  </span>
                </div>
                <div
                  className="mt-0.5 truncate font-mono text-[0.7rem] text-muted-foreground"
                  title={mcpSummary(srv)}
                >
                  {mcpSummary(srv)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeServer(key)}
                disabled={saving}
                aria-label={`Remove ${key}`}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/50 p-2.5">
        <span className="text-xs font-medium text-foreground">Add server</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name (e.g. filesystem)"
          className={inputClass}
        />
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          <TypeToggle
            active={serverType === 'local'}
            onClick={() => setServerType('local')}
            label="Local"
          />
          <TypeToggle
            active={serverType === 'remote'}
            onClick={() => setServerType('remote')}
            label="Remote"
          />
        </div>
        {serverType === 'local' ? (
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="command e.g. npx -y some-mcp"
            className={inputClass}
          />
        ) : (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/mcp"
            className={inputClass}
          />
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={addServer} disabled={saving}>
            {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add server
          </Button>
          {saved && <SavedTag />}
          {error && <ErrorTag>{error}</ErrorTag>}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Skills / agents                                                     */
/* ------------------------------------------------------------------ */

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function AgentsSection({ session }: { session: SessionApi }) {
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const slug = slugify(name)

  async function create() {
    if (!slug) {
      setError('Enter a name for the agent.')
      return
    }
    if (!body.trim()) {
      setError('Add some markdown for the agent.')
      return
    }
    setSaving(true)
    setError(null)
    setSavedPath(null)
    const path = `/workspace/.opencode/agents/${slug}.md`
    try {
      const ok = await session.writeFile(path, body)
      if (ok) {
        setSavedPath(`.opencode/agents/${slug}.md`)
        window.setTimeout(() => setSavedPath(null), 4000)
      } else {
        setError('Could not save the agent file.')
      }
    } catch {
      setError('Could not save the agent file.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading
        title="Custom agent"
        hint="Create a subagent/skill saved as markdown under .opencode/agents."
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name (e.g. code reviewer)"
        className={inputClass}
      />
      {slug && (
        <p className="font-mono text-[0.7rem] text-muted-foreground">.opencode/agents/{slug}.md</p>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={12}
        spellCheck={false}
        placeholder={'# Code reviewer\n\nYou are a meticulous reviewer. When invoked…'}
        className={textareaClass}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={create} disabled={saving}>
          {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Create agent
        </Button>
        {savedPath && <SavedTag>Saved to {savedPath}</SavedTag>}
        {error && <ErrorTag>{error}</ErrorTag>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function SubTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function TypeToggle({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <LoaderCircle className="size-3.5 animate-spin" /> Loading…
    </div>
  )
}

function Note({ tone, children }: { tone?: 'error'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs',
        tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
      )}
    >
      <AlertCircle className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

function SavedTag({ children }: { children?: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-success">
      <Check className="size-3.5" /> {children ?? 'Saved'}
    </span>
  )
}

function ErrorTag({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-xs font-medium text-destructive">
      <AlertCircle className="size-3.5" /> {children}
    </span>
  )
}
