import { defineConfig } from 'vite'

/**
 * `base` is an ABSOLUTE path, not './'.
 *
 * Relative asset URLs cost us a live demo. With base './', opening
 * `https://host/wot-demo` — the same address without its trailing slash —
 * makes the browser resolve `./assets/index-*.js` against `/` instead of
 * `/wot-demo/`. Both the script and the stylesheet 404, `color-scheme: dark`
 * paints the canvas black, `<noscript>` stays hidden because JS is in fact
 * enabled, and the page is a silent black rectangle on someone's phone. The
 * server returns 200 the whole time, so nothing looks wrong from the outside.
 *
 * An absolute base makes the trailing slash irrelevant. The cost is that the
 * deploy path is baked into the build, hence WOT_BASE: build once per target.
 *
 *   WOT_BASE=/wot/demo1/ npx vite build
 */
export default defineConfig(({ command }) => ({
  // The dev server stays at the root so `pnpm dev` and the e2e scripts keep
  // pointing at plain http://localhost:5180/. Only the built output carries
  // the deploy path.
  base: command === 'build' ? (process.env.WOT_BASE ?? '/wot/demo1/') : '/',
  build: { target: 'es2020', outDir: 'dist', assetsDir: 'assets', sourcemap: false },
  server: { host: true, port: 5180 },
}))
