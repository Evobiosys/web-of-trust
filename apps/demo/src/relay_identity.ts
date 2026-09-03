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
 * `cached` is a module-level in-memory shortcut, not a second source of
 * truth: it exists so a screen that already has the identity in hand this
 * boot does not have to await a `kvGet` round trip on every render. A page
 * reload naturally clears it; `resetAll()` (state.ts) is always followed by
 * `location.reload()` (main.ts), so no explicit cache-invalidation call is
 * needed here.
 */
import type { Identity as DidIdentity } from './did'
import { createIdentity, deserializeIdentity, serializeIdentity } from './did'
import type { DeviceState } from './state'
import { saveState } from './state'

let cached: DidIdentity | null = null

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
 * first call if `s.relayIdentity` is not already set.
 */
export async function ensureRelayIdentity(s: DeviceState): Promise<DidIdentity> {
  if (cached) return cached
  if (s.relayIdentity) {
    cached = deserializeIdentity(s.relayIdentity)
    return cached
  }
  const identity = createIdentity(relayServiceEndpoint())
  s.relayIdentity = serializeIdentity(identity)
  await saveState(s)
  cached = identity
  return identity
}
