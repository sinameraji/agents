import { useEffect, useState } from 'react'

export interface Me {
  id: string
  email: string
}

/** Fetch the signed-in user's identity once (Cloudflare Access / dev bypass on the server). */
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
