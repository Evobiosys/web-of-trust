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

/**
 * Build-time SCENARIO switch, orthogonal to `wotMode()` above.
 *
 * `wotMode()` picks the transport (qr/relay/webrtc/ladder); this picks WHICH
 * content and screens run on top of it. Kept as a second flag rather than a
 * fifth `WotMode` value on purpose: nearly every relay-mode call site in
 * main.ts branches on the literal string `wotMode() === 'relay'`
 * (`completeConnectLinkIfPending`, `initRelaySession`, `screenConnect`,
 * `askWith`, `emitAnswer`, …). A new `WotMode` value would silently fall
 * through every one of those checks -- no error, just a demo that never
 * pairs -- so demo 20 is built as `VITE_WOT_MODE=relay` (it needs the exact
 * same transport demo 2 already proves live) PLUS this second env var:
 *
 *   VITE_WOT_MODE=relay VITE_WOT_SCENARIO=geologengasse WOT_BASE=/wot/demo20/ npx vite build
 *
 * Demos 1/2/3/6 never set `VITE_WOT_SCENARIO`, so `wotScenario()` there is
 * always `'default'` -- every scenario-gated branch in main.ts is a no-op for
 * them, and their code paths stay byte-identical to before this flag existed.
 */
export type WotScenario = 'default' | 'geologengasse'

export function wotScenario(): WotScenario {
  const v = import.meta.env?.VITE_WOT_SCENARIO
  return v === 'geologengasse' ? 'geologengasse' : 'default'
}
