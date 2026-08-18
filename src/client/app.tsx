import { RouterProvider } from './router'
import { WorkspaceShell } from './components/workspace-shell'

export function App() {
  return (
    <RouterProvider>
      <WorkspaceShell />
    </RouterProvider>
  )
}
