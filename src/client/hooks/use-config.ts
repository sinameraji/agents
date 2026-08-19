import { useEffect, useState } from 'react'

export interface AppConfig {
  /** 'landing' = the public deploy-your-own page; 'app' = the actual workspace. */
  mode: 'landing' | 'app'
}

/** What this HOST is (public landing vs the app), decided server-side from LANDING_HOSTS.
 *  Failure defaults to 'app' so a bare self-hosted instance always boots into the product. */
export function useConfig(): { config: AppConfig | null } {
  const [config, setConfig] = useState<AppConfig | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : { mode: 'app' }))
      .then((d) => alive && setConfig(d as AppConfig))
      .catch(() => alive && setConfig({ mode: 'app' }))
    return () => {
      alive = false
    }
  }, [])
  return { config }
}
