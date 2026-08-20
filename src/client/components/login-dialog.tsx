'use client'

import { useEffect, useMemo, useState } from 'react'
import { Boxes, Check, Copy, Globe, Users, Wallet, X } from 'lucide-react'

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

/** One row of the pre-flight checklist: a field Cloudflare will ask for, with its value ready to
 *  copy when we can generate it for them. */
function Field({ name, hint, value }: { name: string; hint: string; value?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-foreground">{name}</span>
        {value && (
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
        )}
      </div>
      {value && <code className="truncate font-mono text-[0.7rem] text-muted-foreground">{value}</code>}
      <span className="text-xs text-muted-foreground">{hint}</span>
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
          (deploy ? 'max-w-lg overflow-hidden' : 'max-w-sm items-center gap-4 p-6')
        }
      >
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="absolute top-3 right-3 z-10 text-white/80 hover:text-white">
          <X className="size-4" />
        </Button>

        {deploy ? (
          <>
            {/* Visual hero: the brand at a glance */}
            <img src="/og.png" alt="Agents. Your favorite coding model, harness, and provider in your browser." className="w-full" />

            <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-6">
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

              <div className="rounded-lg border border-border p-3">
                <h3 className="text-sm font-semibold">What Cloudflare will ask you for</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  The next page is one form. It needs a Workers Paid plan with R2 enabled, and these
                  values. The two secrets below are generated right here in your browser, so copy them
                  now and paste them into the matching fields.
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  <Field name="Git account" hint="Connect GitHub or GitLab. Cloudflare copies this repo into your account and redeploys on every push." />
                  <Field name="R2 buckets (2)" hint="One for uploads, one for workspace snapshots. Click new on each and accept the suggested name." />
                  <Field name="ENCRYPTION_KEY" hint="Encrypts the model provider keys you paste into Settings." value={encryptionKey} />
                  <Field name="AUTH_SECRET" hint="Signs your login session cookie." value={authSecret} />
                  <Field name="APP_PASSWORD" hint="You choose it. It is the password you log in with, so make it strong." />
                  <Field name="OWNER_EMAIL" hint="Your email. Makes you the admin who can invite members. Optional." />
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Leave the build, deploy and preview commands exactly as they are. The first deploy
                  takes several minutes because it builds the sandbox container image.
                </p>
              </div>

              <a
                href={DEPLOY}
                target="_blank"
                rel="noreferrer"
                className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-[#F6821F] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#e2760f]"
              >
                <CloudflareMark fill="#fff" className="size-5" />
                Deploy to Cloudflare
              </a>
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
