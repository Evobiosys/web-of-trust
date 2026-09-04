/**
 * Mints and persists this device's did:peer:2 identity (did.ts), relay mode
 * only.
 *
 * Called lazily, not on every `seedPersona()` -- a qr-mode build never calls
 * this at all, so it never touches did.ts's key generation. The identity is
 * stored inside `DeviceState.relayIdentity` (state.ts) via the existing
 * `saveState`, so it is written to the same IndexedDB record as everything
 * else and reused across reloads exactly like `state.me`, `state.threads`,
 * etc. On a device with blocked storage (`storageIsEphemeral()`, db.ts) that
 * means the identity is per-visit, same as the rest of DeviceState -- this
 * module does nothing extra to fight that, on purpose (handover's point 1).
 *
 * `cachedPromise` is a module-level in-memory shortcut, not a second source
 * of truth: it exists so a screen that already has the identity in hand this
 * boot does not have to await a `kvGet` round trip on every render. A page
 * reload naturally clears it; `resetAll()` (state.ts) is always followed by
 * `location.reload()` (main.ts), so no explicit cache-invalidation call is
 * needed here.
 *
 * SINGLE-FLIGHT, DELIBERATELY (root-caused 2026-09-04, the "second guest"
 * relay bug): this used to cache the RESOLVED identity (`cached: DidIdentity
 * | null`), checked with a plain `if (cached) return cached` before the
 * mint-and-persist path's `await saveState(s)`. That is a classic
 * check-then-act race -- two calls that land before either has resolved
 * BOTH see `cached === null` and (if `s.relayIdentity` isn't set yet either)
 * BOTH call `createIdentity()`, minting two DIFFERENT random did:peer:2
 * identities for the same device and racing to persist one over the other.
 * Concretely: main.ts's `seedJakob()` used to fire `initRelaySession()`
 * without awaiting it, and `boot()` unconditionally fired `initRelaySession()`
 * again right after -- two concurrent `bringUpRelayChannel()` calls, each
 * calling `ensureRelayIdentity()`, landing inside that gap. main.ts's own
 * `bringUpRelayChannel()` is now single-flight too (belt-and-suspenders,
 * see its doc comment), but this function is called from several other
 * independent sites (`showConnectLinkCode()`, `showMyConnectCode()`,
 * `pairKey()`) that are not covered by that guard, so the race has to be
 * closed HERE to be closed for good. Caching the in-flight PROMISE rather
 * than the resolved value means every concurrent caller, no matter how many,
 * shares the exact same mint-or-load operation and therefore the exact same
 * identity -- there is no window left in which two callers can both see
 * "nothing yet" and both mint.
 */
import type { Identity as DidIdentity } from './did'
import { createIdentity, deserializeIdentity, serializeIdentity } from './did'
import type { DeviceState } from './state'
import { saveState } from './state'

let cachedPromise: Promise<DidIdentity> | null = null

/**
 * Informational only -- carried on the did:peer:2 service block for
 * shape-compatibility with `did_identity.ts`, but `relay.ts` routes on the
 * DID itself, never on this field (see did.ts's `Identity.serviceEndpoint`
 * doc comment). Kept short: it counts toward the connect QR's payload size.
 */
function relayServiceEndpoint(): string {
  if (typeof location !== 'undefined' && location.origin) return location.origin + '/relay'
  return 'https://questhub.eco/relay'
}

/**
 * Returns this device's did:peer:2 identity, minting and persisting one on
 * first call if `s.relayIdentity` is not already set. Single-flight: every
 * call this session before the FIRST one resolves shares that same call's
 * promise (and therefore its result) rather than independently racing the
 * "mint or load" decision -- see this module's doc comment.
 */
export function ensureRelayIdentity(s: DeviceState): Promise<DidIdentity> {
  if (cachedPromise) return cachedPromise
  cachedPromise = (async () => {
    if (s.relayIdentity) return deserializeIdentity(s.relayIdentity)
    const identity = createIdentity(relayServiceEndpoint())
    s.relayIdentity = serializeIdentity(identity)
    await saveState(s)
    return identity
  })()
  return cachedPromise
}
