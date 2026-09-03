/**
 * Build-time transport mode.
 *
 * `import.meta.env.VITE_WOT_MODE` is a plain Vite-injected build-time
 * constant (any `VITE_`-prefixed env var Vite sees at build time is baked
 * into the bundle, replacing this read with a literal) -- no `vite.config.ts`
 * change is needed to wire it up, the same mechanism `relay.ts` already uses
 * for `VITE_RELAY_ORIGIN`.
 *
 *   VITE_WOT_MODE=relay  WOT_BASE=/wot/demo2/ npx vite build   -- demo 2
 *   VITE_WOT_MODE=webrtc WOT_BASE=/wot/demo3/ npx vite build   -- demo 3, rung 2 alone
 *   VITE_WOT_MODE=ladder WOT_BASE=/wot/demo6/ npx vite build   -- demo 6, the ladder
 *   WOT_BASE=/wot/demo1/ npx vite build                        -- demo 1, unchanged
 *
 * Demo 1's build never sets this, so `wotMode()` there is always `'qr'` --
 * the exact behaviour that existed before this file did, and adding
 * `'webrtc'`/`'ladder'` below changes nothing about that: any value other
 * than exactly `'relay'`, `'webrtc'` or `'ladder'` -- unset, a typo, an old
 * value -- still falls through to `'qr'`, same as before this file grew a
 * third and fourth mode.
 */
export type WotMode = 'qr' | 'relay' | 'webrtc' | 'ladder'

export function wotMode(): WotMode {
  const v = import.meta.env?.VITE_WOT_MODE
  if (v === 'relay' || v === 'webrtc' || v === 'ladder') return v
  return 'qr'
}
