'use client'

import { ExternalLink } from 'lucide-react'

import { HARNESSES } from '~shared/protocol'
import { CloudflareMark } from './login-screen'
import { HARNESS_MARKS, AnthropicMark, OpenAIMark, OpenRouterMark } from './brand-marks'

const REPO = 'https://github.com/sinameraji/dreamweav'
const DEPLOY = `https://deploy.workers.cloudflare.com/?url=${REPO}`

const PROVIDERS: { id: string; label: string; blurb: string; Mark: (p: { className?: string }) => React.ReactNode }[] = [
  { id: 'anthropic', label: 'Anthropic', blurb: 'Claude, direct API', Mark: AnthropicMark },
  { id: 'cloudflare', label: 'Cloudflare', blurb: 'Workers AI + AI Gateway unified billing', Mark: CloudflareMark },
  { id: 'openai', label: 'OpenAI', blurb: 'GPT, direct API', Mark: OpenAIMark },
  { id: 'openrouter', label: 'OpenRouter', blurb: 'Model marketplace, one API', Mark: OpenRouterMark },
]

/** The public face of dreamweav.com: Dreamweav is self-hosted software, so the one call to
 *  action is deploying your own. No login here, the app lives on each owner's own host. */
export function Landing() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-12 sm:py-20">
        {/* Header */}
        <header className="flex items-center gap-2.5">
          <img src="/icon-192.png" alt="" aria-hidden className="size-9" />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-semibold tracking-tight">Dreamweav</span>
            <span className="text-xs text-muted-foreground">coding agents in your browser</span>
          </div>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            GitHub <ExternalLink className="size-3.5" />
          </a>
        </header>

        {/* Hero */}
        <section className="flex flex-col gap-5">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Your coding agents, on your Cloudflare.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
            Dreamweav is a self-hosted home for AI coding agents. Each session runs in an isolated
            sandbox with a live preview, driven from any browser. You deploy it to your own
            Cloudflare account: your containers, your keys, your bill. There is no hosted service.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={DEPLOY}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center gap-2.5 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <CloudflareMark className="size-5" />
              Deploy to Cloudflare
            </a>
            <a
              href={`${REPO}#deploy-your-own`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Read the setup guide
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            Needs a Cloudflare account on the Workers Paid plan. One command: <span className="font-mono">npm run setup</span>
          </p>
        </section>

        {/* Harnesses */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Pick your harness
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {HARNESSES.filter((h) => h.enabled).map((h) => {
              const Mark = HARNESS_MARKS[h.id]
              return (
                <a
                  key={h.id}
                  href={h.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/60"
                >
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background">
                    {Mark ? <Mark className="size-4.5" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{h.label}</span>
                    <span className="text-xs leading-relaxed text-muted-foreground">{h.blurb}</span>
                  </span>
                </a>
              )
            })}
          </div>
        </section>

        {/* Providers */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Bring your own models
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROVIDERS.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background">
                  <p.Mark className="size-4.5" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{p.label}</span>
                  <span className="text-xs text-muted-foreground">{p.blurb}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Keys are encrypted at rest on your instance and only used to run your sessions.
          </p>
        </section>

        {/* Footer */}
        <footer className="flex items-center gap-2 border-t border-border pt-6 text-xs text-muted-foreground">
          <span>
            Built by{' '}
            <a href="https://github.com/sinameraji" target="_blank" rel="noreferrer" className="text-primary hover:underline">
              Sina Meraji
            </a>
            . Open source.
          </span>
          <a href={REPO} target="_blank" rel="noreferrer" className="ml-auto font-mono hover:text-foreground">
            sinameraji/dreamweav
          </a>
        </footer>
      </div>
    </div>
  )
}
