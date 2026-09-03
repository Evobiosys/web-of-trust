import { describe, expect, it } from 'vitest'
import {
  buildOuterWire,
  decryptEnvelope,
  encryptEnvelope,
  parseOuterWire,
} from '../src/relay'
import { derivePairKey, randomBytes, seal, toB64u } from '../src/crypto'
import type { AnswerEnvelope, QueryEnvelope } from '../src/types'

function makeQuery(qid = 'qid-abc12345'): QueryEnvelope {
  return {
    v: 1,
    t: 'query',
    from: { id: 'asker001', displayName: 'Nora' },
    templateId: 'tmpl-housing-1',
    templateVersion: 1,
    qid,
    issuedAt: Date.now(),
  }
}

function makeAnswer(qid = 'qid-abc12345'): AnswerEnvelope {
  return { v: 1, t: 'answer', qid, body: 'x'.repeat(512) }
}

// ---------------------------------------------------------------------------
// Outer wire framing -- pure, no crypto.
// ---------------------------------------------------------------------------

describe('buildOuterWire / parseOuterWire', () => {
  it('round-trips to/from/payload', () => {
    const raw = buildOuterWire('did:peer:2.Vabc.Edef.Sghi', 'did:peer:2.Vjkl.Emno.Spqr', 'cGF5bG9hZA')
    const parsed = parseOuterWire(raw)
    expect(parsed).toEqual({
      to: 'did:peer:2.Vabc.Edef.Sghi',
      from: 'did:peer:2.Vjkl.Emno.Spqr',
      payload: 'cGF5bG9hZA',
    })
  })

  it('the relay-visible "to" field is a plain top-level JSON string property, matching relay_server.ts submit()', () => {
    const raw = buildOuterWire('did:peer:2.to', 'did:peer:2.from', 'payload')
    const outer = JSON.parse(raw) as { to: unknown }
    expect(typeof outer.to).toBe('string')
    expect(outer.to).toBe('did:peer:2.to')
  })

  it.each([
    ['not JSON at all', 'not json'],
    ['a JSON array, not an object', '[1,2,3]'],
    ['null', 'null'],
    ['missing to', JSON.stringify({ from: 'a', payload: 'b' })],
    ['empty to', JSON.stringify({ to: '', from: 'a', payload: 'b' })],
    ['missing from', JSON.stringify({ to: 'a', payload: 'b' })],
    ['missing payload', JSON.stringify({ to: 'a', from: 'b' })],
    ['non-string to', JSON.stringify({ to: 1, from: 'a', payload: 'b' })],
  ])('rejects malformed input: %s', (_label, input) => {
    expect(parseOuterWire(input)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// encrypt/decrypt round trip
// ---------------------------------------------------------------------------

describe('encryptEnvelope / decryptEnvelope', () => {
  it('round-trips a QueryEnvelope under a derived pair key', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    const query = makeQuery()

    const payload = await encryptEnvelope(query, pairKey)
    const decoded = await decryptEnvelope(payload, pairKey)

    expect(decoded).toEqual(query)
  })

  it('round-trips an AnswerEnvelope under a derived pair key', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    const answer = makeAnswer()

    const payload = await encryptEnvelope(answer, pairKey)
    const decoded = await decryptEnvelope(payload, pairKey)

    expect(decoded).toEqual(answer)
  })

  it('produces a different IV (and therefore different payload) on every call, even for the identical envelope', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    const query = makeQuery()

    const a = await encryptEnvelope(query, pairKey)
    const b = await encryptEnvelope(query, pairKey)

    expect(a).not.toBe(b)
  })

  it('fails to decrypt under the WRONG pair key', async () => {
    const pairKeyA = await derivePairKey('anna-nonce', 'ben-nonce')
    const pairKeyWrong = await derivePairKey('mallory-nonce', 'someone-else-nonce')
    const query = makeQuery()

    const payload = await encryptEnvelope(query, pairKeyA)
    const decoded = await decryptEnvelope(payload, pairKeyWrong)

    expect(decoded).toBeNull()
  })

  it('fails on a tampered ciphertext byte (AEAD authentication)', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    const payload = await encryptEnvelope(makeQuery(), pairKey)

    // Flip an interior character (never the last one -- an unpadded
    // base64url string's final char can carry unused low bits, so flipping
    // it can spuriously decode to the same byte; see relay_client.test.ts's
    // identical caveat in packages/browser-agent for the same reasoning).
    const flipIndex = Math.floor(payload.length / 2)
    const flipped =
      payload.slice(0, flipIndex) +
      (payload[flipIndex] === 'A' ? 'B' : 'A') +
      payload.slice(flipIndex + 1)

    expect(await decryptEnvelope(flipped, pairKey)).toBeNull()
  })

  it('never throws on a too-short payload (shorter than one IV)', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    await expect(decryptEnvelope(toB64u(randomBytes(4)), pairKey)).resolves.toBeNull()
  })

  it('never throws on garbage base64url', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    await expect(decryptEnvelope('not valid base64url!!!', pairKey)).resolves.toBeNull()
  })

  it('returns null when the decrypted plaintext authenticates but is not a recognised envelope (decodeFromQr rejects it)', async () => {
    const pairKey = await derivePairKey('nonce-a', 'nonce-b')
    const iv = randomBytes(12)
    const notAnEnvelope = new TextEncoder().encode(JSON.stringify({ hello: 'world' }))
    const ciphertext = await seal(pairKey, iv, notAnEnvelope)
    const framed = new Uint8Array(iv.length + ciphertext.length)
    framed.set(iv, 0)
    framed.set(ciphertext, iv.length)

    expect(await decryptEnvelope(toB64u(framed), pairKey)).toBeNull()
  })
})
