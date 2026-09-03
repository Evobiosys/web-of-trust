// @vitest-environment node
//
// THE GATE (handover-relay-did.md, Task 1). Everything downstream -- the
// relay channel, the whole "browser device talks to the live questhub relay"
// feature -- depends on the demo's browser-native did.ts producing DIDs the
// SERVER accepts, byte for byte. This is the one test in this feature that
// imports the real, Node-only `resolveDidPeer` from
// `packages/transport/src/did_identity.ts` (safe here: this is a Node test
// file, so `Buffer` is available) side by side with the demo's browser-safe
// `did.ts`, and proves they agree.
//
// Run under the "node" vitest environment override (not this project's
// default jsdom -- see vite.config.ts) purely so this file's intent reads
// unambiguously; nothing here actually depends on DOM absence or presence.
import { describe, expect, it } from 'vitest'
import { resolveDidPeer as serverResolveDidPeer } from '../../../packages/transport/src/did_identity'
import { createIdentity, signChallenge } from '../src/did'
import { ed25519 } from '@noble/curves/ed25519.js'
import { fromB64u, randomBytes, toB64u } from '../src/crypto'

const IDENTITY_COUNT = 50

describe('did.ts <-> packages/transport/src/did_identity.ts interop (the relay-did gate)', () => {
  it(`the server's real resolveDidPeer decodes ${IDENTITY_COUNT} demo-minted DIDs to the exact same keys and endpoint`, () => {
    for (let i = 0; i < IDENTITY_COUNT; i++) {
      const endpoint = `https://relay.invalid/demo-peer-${i}`
      const identity = createIdentity(endpoint)

      const resolved = serverResolveDidPeer(identity.did)

      expect(Array.from(resolved.signingPublicKey)).toEqual(Array.from(identity.signing.publicKey))
      expect(Array.from(resolved.keyAgreementPublicKey)).toEqual(Array.from(identity.keyAgreement.publicKey))
      expect(resolved.serviceEndpoint).toBe(endpoint)
    }
  })

  it(`a signChallenge signature verifies against the server's resolveDidPeer(did).signingPublicKey, for ${IDENTITY_COUNT} identities`, () => {
    for (let i = 0; i < IDENTITY_COUNT; i++) {
      const identity = createIdentity(`https://relay.invalid/demo-peer-sig-${i}`)
      const nonce = toB64u(randomBytes(24)) // shape of relay_server.ts's own challenge nonce

      const sigB64u = signChallenge(identity, nonce)

      const resolved = serverResolveDidPeer(identity.did)
      const verified = ed25519.verify(fromB64u(sigB64u), fromB64u(nonce), resolved.signingPublicKey)
      expect(verified).toBe(true)
    }
  })

  it('a signature made with the WRONG identity does not verify (sanity: the above is not vacuously true)', () => {
    const owner = createIdentity('https://relay.invalid/owner')
    const impostor = createIdentity('https://relay.invalid/impostor')
    const nonce = toB64u(randomBytes(24))

    // Sign with the impostor's key but resolve the owner's claimed DID --
    // mirrors exactly what relay_server.ts's handleAuth rejects.
    const forgedSig = signChallenge(impostor, nonce)
    const resolvedOwner = serverResolveDidPeer(owner.did)
    const verified = ed25519.verify(fromB64u(forgedSig), fromB64u(nonce), resolvedOwner.signingPublicKey)
    expect(verified).toBe(false)
  })
})
