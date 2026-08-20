'use client'

import { useEffect } from 'react'
import { Boxes, Globe, Users, Wallet, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { LoginOptions, CloudflareMark } from './login-screen'

const REPO = 'https://github.com/sinameraji/agents'
const DEPLOY = `https://deploy.workers.cloudflare.com/?url=${REPO}`

/** Raised when a guest attempts something consequential. On a normal instance it offers login;
 *  on the public host (`deploy`) it makes the self-host pitch, since there's no hosted service. */
export function LoginDialog({ onClose, deploy }: { onClose: () => void; deploy?: boolean }) {
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
            {/* Visual hero — the brand at a glance */}
            <img src="/og.png" alt="Agents. — your favorite coding model, harness, and provider in your browser" className="w-full" />

            <div className="flex flex-col gap-4 p-6">
              <div>
                <h2 className="text-base font-semibold">Run Agents. for your whole company</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  There is no hosted service — you deploy it to your own Cloudflare. Your containers,
                  your keys, your bill.
                </p>
              </div>

              <ul className="flex flex-col gap-2.5 text-sm">
                <ProTip icon={<Globe className="size-4" />}>
                  Point a custom domain — <span className="font-mono text-foreground">agents.yourcompany.com</span>
                </ProTip>
                <ProTip icon={<Users className="size-4" />}>
                  Invite your team with access control — nobody sees anyone else's sessions
                </ProTip>
                <ProTip icon={<Wallet className="size-4" />}>
                  Everyone sees their own token usage; you set optional budget caps
                </ProTip>
                <ProTip icon={<Boxes className="size-4" />}>
                  Each person brings their own model, harness, and provider
                </ProTip>
              </ul>

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
