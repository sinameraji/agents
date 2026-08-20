'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Boxes, Check, Copy, Eye, EyeOff, Globe, Users, Wallet, X } from 'lucide-react'

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
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-[0.7rem] text-muted-foreground">{cost}</span>
      </div>
      <span className="text-xs leading-snug text-muted-foreground">{children}</span>
      <a href={href} target="_blank" rel="noreferrer" className="mt-0.5 text-xs font-medium text-primary hover:underline">
        {cta}
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
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="absolute top-3 right-3 z-10 text-white/80 hover:text-white">
          <X className="size-4" />
        </Button>

        {deploy ? (
          <>
            {/* Visual hero: the brand at a glance */}
            <img
              src="/og.png"
              alt="Agents. Your favorite coding model, harness, and provider in your browser."
              className="max-h-[26vh] w-full shrink-0 object-cover"
            />

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
                      Three accounts or settings need to exist first. The two Cloudflare ones are the
                      reason a deploy otherwise fails partway through.
                    </p>
                  </div>
                  <ul className="flex flex-col gap-2.5">
                    <Prereq
                      title="Workers Paid plan"
                      cost="$5 per month"
                      href="https://dash.cloudflare.com/?to=/:account/workers/plans"
                      cta="Open Workers plans"
                    >
                      Every session runs in a Cloudflare Container, and containers are not on the free plan.
                    </Prereq>
                    <Prereq
                      title="R2 turned on"
                      cost="free for normal use"
                      href="https://dash.cloudflare.com/?to=/:account/r2"
                      cta="Open R2"
                    >
                      Cloudflare calls this an R2 subscription, but the free tier covers 10 GB of storage
                      with free egress, which is far more than uploads and workspace snapshots need.
                    </Prereq>
                    <Prereq
                      title="A GitHub or GitLab account"
                      cost="free"
                      href="https://github.com"
                      cta="Open GitHub"
                    >
                      Cloudflare copies this repo into your account and redeploys it on every push, so
                      your instance stays yours.
                    </Prereq>
                  </ul>
                </>
              )}

              {step === 3 && (
                <>
                  <div>
                    <h2 className="text-base font-semibold">What Cloudflare will ask you for</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The next page is one long form. These are the fields worth preparing. The two
                      secrets are generated here in your browser and never leave this page, so copy
                      them straight across.
                    </p>
                  </div>
                  <ul className="flex flex-col gap-2">
                    <Field name="Git account" hint="Connect GitHub or GitLab, then leave the repository name as it is." />
                    <Field name="R2 buckets (2)" hint="One for uploads, one for workspace snapshots. Click new on each and accept the suggested name." />
                    <Field name="ENCRYPTION_KEY" hint="Encrypts the model provider keys you paste into Settings." value={encryptionKey} />
                    <Field name="AUTH_SECRET" hint="Signs your login session cookie." value={authSecret} />
                    <Field name="APP_PASSWORD" hint="You choose it. It is the password you log in with, so make it strong." />
                    <Field name="OWNER_EMAIL" hint="Your email. Makes you the admin who can invite members. Optional." />
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Leave the build, deploy and preview commands exactly as they are. The first deploy
                    takes several minutes because it builds the sandbox container image.
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
              <a
                href={`${REPO}#deploy-your-own`}
                target="_blank"
                rel="noreferrer"
                className="text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Read the setup guide
              </a>
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
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  )
}
