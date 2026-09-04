/**
 * Regression test for the "second guest" relay reliability bug
 * (root-caused 2026-09-04): Jakob's laptop, on a fresh geologengasse boot,
 * used to build TWO independent `RelayChannel` instances -- two independent
 * `/relay/drain` WebSocket connections, both authenticating as the same
 * did:peer:2 -- because `seedJakob()` fired `initRelaySession()` without
 * awaiting it, and `boot()` unconditionally fired `initRelaySession()`
 * again immediately afterward for the same boot. `bringUpRelayChannel()`
 * did not assign the module-level `relayChannel` guard until AFTER its
 * first `await` (`ensureRelayIdentity()`), so the second call's identical
 * `if (relayChannel) return` guard raced the first and also passed.
 *
 * `relay_server.ts` keeps exactly one live drain per DID and closes the
 * prior connection the moment a new one authenticates (`handleAuth`'s
 * `prior.close()`), so the two channels then fought over that one slot --
 * reconnecting, displacing each other, racing their own un-acked-wire
 * redelivery. That is what produced the reported symptoms: a second guest's
 * pending-request card that sometimes never renders, and a broadcast query
 * that sometimes never reaches (or reaches twice) whichever peer's wire
 * happened to land mid-fight. Proven live against the deployed demo 20
 * build BEFORE this fix: 4-5 drain sockets opened within ~2s of boot, every
 * run. This test asserts exactly ONE.
 *
 * The check is deliberately narrow and deterministic -- socket COUNT on a
 * single fresh boot, not live-relay message-delivery timing -- so it is not
 * flaky the way asserting on delivery outcomes over a real network would
 * be. It exercises the ACTUAL app boot sequence (main.ts's boot() ->
 * seedJakob() -> bringUpRelayChannel(), through a real browser), not a
 * reimplementation of it, and it only needs the drain WebSocket (not the
 * CORS-locked ingress POST -- see relay.ts's module header for why the
 * drain handshake works cross-origin regardless of where this page is
 * served from), so it runs against ANY reachable relay, live or local.
 *
 * Run N times to additionally show this is not itself flaky in the other
 * direction (i.e. that the fix doesn't merely reduce the RATE of the race
 * without closing it):
 *
 *   WOT_URL=https://app.idea2.site/wot/demo20/ RELAY_ORIGIN=https://app.idea2.site \
 *     node test/e2e/second_guest_relay.mjs
 *
 * A locally built demo20 pointed at a real relay also works (this is how
 * the fix was actually verified during development, since a local dev
 * server's origin cannot itself post to a remote relay's ingress -- but the
 * drain socket this test checks is unaffected by that):
 *
 *   WOT_BASE=/ VITE_WOT_MODE=relay VITE_WOT_SCENARIO=geologengasse \
 *     VITE_RELAY_ORIGIN=https://app.idea2.site npx vite build
 *   npx vite preview --port 5199 --strictPort &
 *   WOT_URL=http://localhost:5199/ node test/e2e/second_guest_relay.mjs
 */
/**
 * Playwright is intentionally NOT a dependency of this app -- see
 * seven_steps.mjs's identical header note. Point PLAYWRIGHT_PACKAGE at an
 * absolute path to a playwright install if it is not resolvable from here.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')

const URL = process.env.WOT_URL || 'http://localhost:5199/'
const RUNS = Number(process.env.RUNS || 5)
const SETTLE_MS = 4000 // longer than reconnectBaseMs (1s) so an errant reconnect has time to fire

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}

async function countDrainSockets(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    const OrigWS = window.WebSocket
    window.__drainOpens = 0
    window.WebSocket = new Proxy(OrigWS, {
      construct(target, args) {
        if (typeof args[0] === 'string' && args[0].includes('/relay/drain')) window.__drainOpens += 1
        return new target(...args)
      },
    })
  })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(SETTLE_MS)
  const count = await page.evaluate(() => window.__drainOpens ?? 0)
  await ctx.close()
  return count
}

async function main() {
  console.log(`second_guest_relay: targeting ${URL}, ${RUNS} fresh boots`)
  const browser = await chromium.launch({ headless: true })

  for (let i = 1; i <= RUNS; i++) {
    const count = await countDrainSockets(browser)
    ok(`boot ${i}/${RUNS}: exactly one /relay/drain socket opened (got ${count})`, count === 1)
  }

  await browser.close()
  if (failures > 0) {
    console.log(`\n${failures} run(s) opened more than one drain socket -- the "second guest" race is present`)
    process.exit(1)
  }
  console.log(`\nAll ${RUNS} boots opened exactly one drain socket.`)
  process.exit(0)
}

main().catch((err) => { console.error('second_guest_relay: uncaught error:', err); process.exit(1) })
