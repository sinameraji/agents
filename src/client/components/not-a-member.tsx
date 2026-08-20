import { LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Shown when the visitor is authenticated (we know their email) but is not an active member of
 * this instance. Access is membership-only: an admin must invite them. The only action offered is
 * signing out to try a different account.
 */
export function NotAMember({ email }: { email: string }) {
  return (
    <main className="flex h-dvh w-full items-center justify-center bg-background p-6 text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full border border-border bg-muted">
          <LockKeyhole className="size-5 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-base font-semibold">You&apos;re not a member yet</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            You&apos;re signed in as{' '}
            <span className="font-medium text-foreground">{email}</span>, but this instance is
            invite-only. Ask an admin to add you, then reload this page.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void fetch('/api/logout', { method: 'POST' }).finally(() => window.location.assign('/'))
          }}
        >
          Sign out
        </Button>
      </div>
    </main>
  )
}
