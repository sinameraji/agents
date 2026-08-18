import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface RouterCtx {
  path: string
  navigate: (to: string) => void
}
const Ctx = createContext<RouterCtx>({ path: '/', navigate: () => {} })

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = (to: string) => {
    if (to === window.location.pathname) return
    window.history.pushState({}, '', to)
    setPath(to)
  }
  return <Ctx.Provider value={{ path, navigate }}>{children}</Ctx.Provider>
}

export function useRouter() {
  return useContext(Ctx)
}

/** Match /s/:id → id, else null. */
export function useSessionRoute(): string | null {
  const { path } = useRouter()
  const m = path.match(/^\/s\/([^/]+)$/)
  return m ? m[1] : null
}
