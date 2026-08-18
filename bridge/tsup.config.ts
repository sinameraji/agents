import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { bridge: 'src/index.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  bundle: true,
  splitting: false,
  // Provide a real `require` so bundled CJS deps (e.g. @vercel/oidc) that do dynamic
  // require('path') work in the ESM output (esbuild's __require shim uses it when present).
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  noExternal: [/.*/],
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
})
