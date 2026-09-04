// The one-scan connect-link ceremony (connect_link.ts): URL build/parse,
// the ConnectAckEnvelope helper, and -- the security-critical part -- that
// X25519 ECDH between two did:peer:2 identities actually produces the SAME
// pair key on both sides, and a DIFFERENT one for a third party, exactly
// like the two-scan ceremony's `derivePairKey` symmetry test in
// wire.test.ts, but for the real key-agreement path this feature adds.
import { describe, expect, it } from 'vitest'
import { createIdentity, ecdhSharedSecret } from '../src/did'
import { deriveEcdhPairKey, open, randomBytes, seal } from '../src/crypto'
import { buildConnectAck, buildConnectLinkUrl, parseConnectLinkParams } from '../src/connect_link'

describe('buildConnectLinkUrl / parseConnectLinkParams', () => {
  const did = 'did:peer:2.Vz6Mkabc.Ez6LSabc.SeyJ0IjoiZG0ifQ'
  const from = { id: 'marlene0', displayName: 'Marlene' }

  it('round-trips did/id/name through a real URL', () => {
    const url = buildConnectLinkUrl('https://app.idea2.site/wot/demo2/', did, from)
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://app.idea2.site/wot/demo2/')
    const params = parseConnectLinkParams(parsed.search)
    expect(params).toEqual({ did, from })
  })

  it('drops any pre-existing search/hash on the origin passed in', () => {
    const url = buildConnectLinkUrl('https://app.idea2.site/wot/demo2/?stale=1#frag', did, from)
    expect(url).not.toContain('stale')
    expect(url).not.toContain('#frag')
  })

  it('survives a display name with spaces, umlauts and punctuation', () => {
    const weirdFrom = { id: 'marlene0', displayName: 'Björk Müller-Grätzl, "die Neue"' }
    const url = buildConnectLinkUrl('https://app.idea2.site/wot/demo2/', did, weirdFrom)
    expect(parseConnectLinkParams(new URL(url).search)).toEqual({ did, from: weirdFrom })
  })

  it('parseConnectLinkParams returns null for an ordinary visit (no connect param)', () => {
    expect(parseConnectLinkParams('')).toBeNull()
    expect(parseConnectLinkParams('?foo=bar')).toBeNull()
  })

  it('parseConnectLinkParams returns null when `id` is present but `connect` is not, and vice versa', () => {
    expect(parseConnectLinkParams('?id=marlene0&name=Marlene')).toBeNull()
    expect(parseConnectLinkParams(`?connect=${encodeURIComponent(did)}&name=Marlene`)).toBeNull()
  })

  it('parseConnectLinkParams defaults an absent `name` to an empty string rather than throwing', () => {
    expect(parseConnectLinkParams(`?connect=${encodeURIComponent(did)}&id=marlene0`)).toEqual({
      did,
      from: { id: 'marlene0', displayName: '' },
    })
  })
})

describe('buildConnectAck', () => {
  it('carries the persona identity and the did:peer:2 identity, and nothing else', () => {
    const identity = createIdentity('https://relay.invalid/connect-ack-test')
    const from = { id: 'nora0000', displayName: 'Nora' }
    const ack = buildConnectAck(from, identity)
    expect(ack).toEqual({ v: 1, t: 'connect-ack', from, did: identity.did })
  })
})

describe('X25519 ECDH pairing (the one-scan ceremony\'s real key agreement)', () => {
  it('both sides derive the SAME shared secret from each other\'s did:peer:2', () => {
    const laptop = createIdentity('https://relay.invalid/laptop')
    const phone = createIdentity('https://relay.invalid/phone')

    const secretFromLaptop = ecdhSharedSecret(laptop, phone.did)
    const secretFromPhone = ecdhSharedSecret(phone, laptop.did)

    expect(Array.from(secretFromLaptop)).toEqual(Array.from(secretFromPhone))
  })

  it('the derived AES-GCM key actually works both ways: encrypt on one side, decrypt on the other', async () => {
    const laptop = createIdentity('https://relay.invalid/laptop-2')
    const phone = createIdentity('https://relay.invalid/phone-2')

    const laptopKey = await deriveEcdhPairKey(ecdhSharedSecret(laptop, phone.did))
    const phoneKey = await deriveEcdhPairKey(ecdhSharedSecret(phone, laptop.did))

    const iv = randomBytes(12)
    const plaintext = new TextEncoder().encode('verbunden mit Nora')
    const ciphertext = await seal(laptopKey, iv, plaintext)
    const opened = await open(phoneKey, iv, ciphertext)

    expect(opened).not.toBeNull()
    expect(new TextDecoder().decode(opened as Uint8Array)).toBe('verbunden mit Nora')
  })

  it('a third identity (e.g. the relay operator, who only ever sees public DIDs) cannot derive the same key', () => {
    const laptop = createIdentity('https://relay.invalid/laptop-3')
    const phone = createIdentity('https://relay.invalid/phone-3')
    const outsider = createIdentity('https://relay.invalid/outsider')

    // The one thing an outsider (the relay) has: both DIDs, in cleartext,
    // exactly as relay.ts's module header says it always will. What it does
    // NOT have is either private key-agreement key -- simulated here by
    // computing ECDH with the outsider's OWN private key against a peer's
    // public DID, which is the absolute best an observer limited to public
    // information could do, and it still does not match.
    const real = ecdhSharedSecret(laptop, phone.did)
    const outsiderGuess = ecdhSharedSecret(outsider, phone.did)

    expect(Array.from(outsiderGuess)).not.toEqual(Array.from(real))
  })

  it('different peer pairs derive different shared secrets', () => {
    const a = createIdentity('https://relay.invalid/a')
    const b = createIdentity('https://relay.invalid/b')
    const c = createIdentity('https://relay.invalid/c')

    const ab = ecdhSharedSecret(a, b.did)
    const ac = ecdhSharedSecret(a, c.did)

    expect(Array.from(ab)).not.toEqual(Array.from(ac))
  })
})
