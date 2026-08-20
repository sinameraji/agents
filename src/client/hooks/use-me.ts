import { useEffect, useState } from 'react'
import type { OrgRole } from '~shared/protocol'

export interface Me {
  id: string
  email: string
  /** Org role, or null when the user is authenticated but NOT an active member (ask-admin screen). */
  role: OrgRole | null
}

/** Fetch the signed-in user's identity + org role once. `me` is null only when unauthenticated;
 *  an authenticated non-member resolves to a `me` with `role: null`. */
export function useMe(): { me: Me | null; loading: boolean } {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setMe(d as Me | null))
      .catch(() => alive && setMe(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])
  return { me, loading }
}
