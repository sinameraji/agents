/** Apply the persisted or system theme before first paint. The prototype toggles a `.light` class. */
export function initTheme() {
  try {
    const saved = localStorage.getItem('dreamweav-theme')
    const light = saved ? saved === 'light' : window.matchMedia('(prefers-color-scheme: light)').matches
    document.documentElement.classList.toggle('light', light)
  } catch {
    /* no-op */
  }
}
