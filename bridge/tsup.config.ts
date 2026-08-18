import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { bridge: 'src/index.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  bundle: true,
  splitting: false,
  noExternal: [/.*/],
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
})
