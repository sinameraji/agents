import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { bridge: 'src/index.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  bundle: true,
  noExternal: [/.*/],
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
})
