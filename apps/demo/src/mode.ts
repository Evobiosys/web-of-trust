/**
 * Build-time transport mode.
 *
 * `import.meta.env.VITE_WOT_MODE` is a plain Vite-injected build-time
 * constant (any `VITE_`-prefixed env var Vite sees at build time is baked
 * into the bundle, replacing this read with a literal) -- no `vite.config.ts`
 * change is needed to wire it up, the same mechanism `relay.ts` already uses
 * for `VITE_RELAY_ORIGIN`.
 *
 *   VITE_WOT_MODE=relay WOT_BASE=/wot/demo2/ npx vite build   -- demo 2
 *   WOT_BASE=/wot/demo1/ npx vite build                       -- demo 1, unchanged
 *
 * Demo 1's build never sets this, so `wotMode()` there is always `'qr'` --
 * the exact behaviour that existed before this file did.
 */
export type WotMode = 'qr' | 'relay'

export function wotMode(): WotMode {
  return import.meta.env?.VITE_WOT_MODE === 'relay' ? 'relay' : 'qr'
}
