import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import { initTheme } from './theme'
import { App } from './app'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
