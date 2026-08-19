'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { LoginOptions } from './login-screen'

/** Raised when a guest attempts something consequential, browsing stays free, doing requires an account. */
export function LoginDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Sign in">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm" />
      <div className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 shadow-2xl">
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="absolute top-3 right-3">
          <X className="size-4" />
        </Button>
        <LoginOptions />
      </div>
    </div>
  )
}
