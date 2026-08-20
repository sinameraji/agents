import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import agents from 'agents/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // WRANGLER_CONFIG lets `npm run deploy:self` build against wrangler.self.jsonc; unset (dev,
  // generic deploys, the deploy button) falls back to the root wrangler.jsonc.
  plugins: [react(), tailwindcss(), agents(), cloudflare({ configPath: process.env.WRANGLER_CONFIG })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/client', import.meta.url)),
      '~shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
})
