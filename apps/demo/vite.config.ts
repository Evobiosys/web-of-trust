import { defineConfig } from 'vite'

// base './' so the bundle works from any subpath (deployed at /wot-demo/).
export default defineConfig({
  base: './',
  build: { target: 'es2020', outDir: 'dist', assetsDir: 'assets', sourcemap: false },
  server: { host: true, port: 5180 },
})
