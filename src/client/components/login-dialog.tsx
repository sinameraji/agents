'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Boxes, Check, Copy, Eye, EyeOff, Globe, Users, Wallet, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { LoginOptions, CloudflareMark } from './login-screen'

const REPO = 'https://github.com/sinameraji/agents'
const DEPLOY = `https://deploy.workers.cloudflare.com/?url=${REPO}`

/** 32 random bytes, base64: exactly what ENCRYPTION_KEY and AUTH_SECRET want. Generated in the
 *  browser with the Web Crypto API and never sent anywhere, so the visitor can paste straight into
 *  Cloudflare's form instead of hunting for a terminal to run openssl in. */
function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
}

/** One row of the pre-flight checklist: a field Cloudflare will ask for. Generated values are
 *  masked until asked for (they are real secrets, and this modal opens on a public page that
 *  people screen-share), and rendered as a boxed value so they never read as more prose. */
function Field({ name, hint, value }: { name: string; hint: string; value?: string }) {
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState(false)
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold tracking-tight text-foreground">{name}</span>
        {value && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShown((v) => !v)}
              className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[0.7rem] text-muted-foreground transition-colors hover:text-foreground"
              aria-label={shown ? `Hide ${name}` : `Reveal ${name}`}
            >
              {shown ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              {shown ? 'Hide' : 'Reveal'}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(value).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
              className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[0.7rem] text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
      {value && (
        <code className="block truncate rounded-md border border-border bg-background px-2 py-1 font-mono text-[0.72rem] text-foreground">
          {shown ? value : '\u2022'.repeat(44)}
        </code>
      )}
      <span className="text-xs leading-snug text-muted-foreground">{hint}</span>
    </li>
  )
}

/** A prerequisite the visitor has to switch on in their own Cloudflare account, with the cost
 *  stated plainly and a link that lands on the right dashboard page. */
function Prereq({ title, cost, href, cta, children }: { title: string; cost: string; href: string; cta: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className="text-[0.7rem] text-muted-foreground">{cost}</span>
        </div>
        <span className="text-xs leading-snug text-muted-foreground">{children}</span>
      </div>
      {/* Brand-tinted so it reads as an action, but never mistaken for the primary or the orange
          Cloudflare CTA. The arrow says it leaves for the dashboard. */}
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary shadow-sm transition-colors hover:border-primary/60 hover:bg-primary/20"
      >
        {cta}
        <ArrowUpRight className="size-3.5" />
      </a>
    </li>
  )
}

/** Raised when a guest attempts something consequential. On a normal instance it offers login;
 *  on the public host (`deploy`) it makes the self-host pitch, since there's no hosted service. */
export function LoginDialog({ onClose, deploy }: { onClose: () => void; deploy?: boolean }) {
  // Generated once per open: re-rolling them while the user is mid-copy would hand Cloudflare a
  // different value than the one they pasted.
  const encryptionKey = useMemo(() => randomSecret(), [])
  const authSecret = useMemo(() => randomSecret(), [])
  // The pitch and the paperwork are different jobs, so they get their own screens: step 1 sells,
  // step 2 prepares. Cramming both made the dialog taller than the window.
  const [step, setStep] = useState<1 | 2 | 3>(1)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={deploy ? 'Deploy your own' : 'Sign in'}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm" />
      <div
        className={
          'relative flex w-full flex-col rounded-2xl border border-border bg-card shadow-2xl ' +
          (deploy ? 'max-h-[92vh] max-w-lg overflow-hidden' : 'max-w-sm items-center gap-4 p-6')
        }
      >
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className={`absolute top-3 right-3 z-10 ${deploy && step > 1 ? 'text-muted-foreground hover:text-foreground' : 'text-white/80 hover:text-white'}`}>
          <X className="size-4" />
        </Button>

        {deploy ? (
          <>
            {/* The hero earns its height on the pitch screen only; the setup screens get a slim
                bar so the whole dialog stays well inside a laptop window. */}
            {step === 1 ? (
              <img
                src="/og.png"
                alt="Agents. Your favorite coding model, harness, and provider in your browser."
                className="max-h-[26vh] w-full shrink-0 object-cover"
              />
            ) : (
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
                <img src="/logo.svg" alt="" className="size-5 rounded" />
                <span className="text-sm font-semibold">Deploy your own</span>
                <span className="ml-auto pr-6 text-xs text-muted-foreground">Step {step} of 3</span>
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
              {step === 1 && (
                <>
                  <div>
                    <h2 className="text-base font-semibold">Run Agents. for your whole company</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      There is no hosted service. You deploy it to your own Cloudflare: your containers,
                      your keys, your bill.
                    </p>
                  </div>
                  <ul className="flex flex-col gap-2.5 text-sm">
                    <ProTip icon={<Globe className="size-4" />}>
                      Point a custom domain at it, like <span className="font-mono text-foreground">agents.yourcompany.com</span>
                    </ProTip>
                    <ProTip icon={<Users className="size-4" />}>
                      Invite your team with access control, so nobody sees anyone else's sessions
                    </ProTip>
                    <ProTip icon={<Wallet className="size-4" />}>
                      Everyone sees their own token usage; you set optional budget caps
                    </ProTip>
                    <ProTip icon={<Boxes className="size-4" />}>
                      Each person brings their own model, harness, and provider
                    </ProTip>
                  </ul>
                </>
              )}

              {step === 2 && (
                <>
                  <div>
                    <h2 className="text-base font-semibold">Before you start</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Two switches in your Cloudflare account. Without them the deploy fails partway.
                    </p>
                  </div>
                  <ul className="flex flex-col gap-2">
                    <Prereq
                      title="Workers Paid"
                      cost="$5 per month"
                      href="https://dash.cloudflare.com/?to=/:account/workers/plans"
                      cta="Enable"
                    >
                      Sessions run in containers, which the free plan does not include.
                    </Prereq>
                    <Prereq
                      title="R2 storage"
                      cost="free"
                      href="https://dash.cloudflare.com/?to=/:account/r2"
                      cta="Enable"
                    >
                      One switch. The free tier covers 10 GB with free egress.
                    </Prereq>
                  </ul>
                </>
              )}

              {step === 3 && (
                <>
                  <div>
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="text-base font-semibold">What Cloudflare will ask you for</h2>
                      <a
                        href={`${REPO}#deploy-your-own`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                      >
                        Full guide
                        <ArrowUpRight className="size-3" />
                      </a>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Copy these across as the form asks for them. Both secrets are generated here in
                      your browser and never leave this page.
                    </p>
                  </div>
                  <ul className="flex flex-col gap-2">
                    <Field name="Connect GitHub or GitLab" hint="Cloudflare copies the repo into your account." />
                    <Field name="Create two R2 buckets" hint="Click new on each, accept the names." />
                    <Field name="ENCRYPTION_KEY" hint="Encrypts your stored provider keys." value={encryptionKey} />
                    <Field name="AUTH_SECRET" hint="Signs your login cookie." value={authSecret} />
                    <Field name="APP_PASSWORD" hint="The password you will log in with." />
                    <Field name="OWNER_EMAIL" hint="Makes you the admin. Optional." />
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Leave the build commands as they are. The first deploy takes a few minutes.
                  </p>
                </>
              )}
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-card p-4">
              <div className="flex items-center gap-2">
                {step > 1 && (
                  <Button variant="outline" onClick={() => setStep((n) => (n === 3 ? 2 : 1))} className="gap-1.5">
                    <ArrowLeft className="size-4" />
                    Back
                  </Button>
                )}
                {step < 3 ? (
                  <Button onClick={() => setStep((n) => (n === 1 ? 2 : 3))} className="flex-1 gap-1.5">
                    Next
                    <ArrowRight className="size-4" />
                  </Button>
                ) : (
                  <a
                    href={DEPLOY}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-9 flex-1 items-center justify-center gap-2.5 rounded-lg bg-[#F6821F] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#e2760f]"
                  >
                    <CloudflareMark fill="#fff" className="size-5" />
                    Deploy to Cloudflare
                  </a>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <LoginOptions />
            <p className="text-center text-xs text-muted-foreground">
              Agents is self-hosted: sessions run on the instance owner's Cloudflare account.{' '}
              <a href={`${REPO}#deploy-your-own`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Deploy your own
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function ProTip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      {/* The badge is taller than one line of text, so centre it inside a box the height of that
          first line. Nudging with a margin only ever looks right at one text length. */}
      <span className="flex h-5 shrink-0 items-center">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</span>
      </span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  )
}
