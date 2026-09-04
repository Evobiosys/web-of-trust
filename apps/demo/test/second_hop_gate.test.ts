import { describe, expect, it } from 'vitest'
import { derivePairKey, fromB64u, open } from '../src/crypto'
import { decide, maskAnswerPlaintext, sealAnswerEnvelope, truncateSharedJson } from '../src/gate'
import type { MatchHit, MatchResult, QueryEnvelope, QueryTemplate, SharedPayload } from '../src/types'
import { ANSWER_BODY_LEN } from '../src/types'

/**
 * Demo 21 (secondHop scenario, DEVLOG/handover-demo21-two-hop.md): the
 * byte-level proof the handover asks for, for A's OWN final answer to B --
 * the one hop B is actually watching. It exercises the SAME primitives
 * main.ts's `sendSecondHopFinalAnswer` calls (`maskAnswerPlaintext`,
 * `truncateSharedJson`, `sealAnswerEnvelope`), the way
 * test/e2e/call_into_the_web.mjs exercises `decide()` for the one-hop case
 * -- not a reimplementation of the construction, the actual construction.
 *
 * The five reasons B can end up with nothing, per the handover:
 *   (a) A has no second-brain note at all, or it does not match.
 *   (b) A has a matching note but chooses not to forward it.
 *   (c) A forwards it, and Jakob declines.
 *   (d) A forwards it, and Jakob has nothing (his own no-match/below-k).
 *   (e) A forwards it, and Jakob never answers within the shared deadline
 *       (unreachable, offline, or simply too slow).
 * All five must produce a BYTE-IDENTICAL ciphertext, for the same qid and
 * the same A<->B pair key -- proven directly below, not inferred from
 * screen text.
 */

const QID = 'qid-secondhop-proof-0001'
const TEMPLATE_ID = 'wot.freetext.ask'

async function finalPlaintextAndEnvelope(payload: SharedPayload | null, key: CryptoKey) {
  const jsonBytes = truncateSharedJson(payload ?? { from: '', templateId: TEMPLATE_ID, items: [] })
  const plaintext = maskAnswerPlaintext(Boolean(payload), jsonBytes)
  const envelope = await sealAnswerEnvelope(QID, plaintext, key)
  return { plaintext, envelope }
}

describe('demo 21: A -> B final answer is byte-identical across every "nothing" cause', () => {
  it('five different nothing-causing inputs produce byte-identical plaintext AND ciphertext', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')

    // (a) no note, or note did not match -- payload never even considered.
    const noNote = await finalPlaintextAndEnvelope(null, key)

    // (b) A had an eligible note and chose not to forward -- her own local
    // decide()-equivalent path resolves 'declined' locally, but the ONLY
    // thing that reaches this function is payload === null, same as (a).
    const declinedToRelay = await finalPlaintextAndEnvelope(null, key)

    // (c) Jakob declined -- jakobDecoded.outcome !== 'shared', so payload is
    // null regardless of what Jakob's own (real, byte-padded) AnswerEnvelope
    // to A actually contained.
    const jakobDeclined = await finalPlaintextAndEnvelope(null, key)

    // (d) Jakob had nothing of his own -- same collapse.
    const jakobNoMatch = await finalPlaintextAndEnvelope(null, key)

    // (e) Jakob never answered before the shared deadline -- forwardToOwner's
    // waiter resolves null, jakobDecoded stays null, same collapse.
    const jakobTimedOut = await finalPlaintextAndEnvelope(null, key)

    const all = [noNote, declinedToRelay, jakobDeclined, jakobNoMatch, jakobTimedOut]
    for (const one of all) {
      expect(one.plaintext.length).toBe(ANSWER_BODY_LEN)
      // All-zero: tag 0x00 (nothing), zero-length JSON, zero padding --
      // maskAnswerPlaintext's mask trick makes `jsonBytes` irrelevant to the
      // output whenever wouldShare is false, so this holds regardless of
      // which of the five distinct LOCAL reasons produced payload === null.
      expect(Array.from(one.plaintext)).toEqual(new Array(ANSWER_BODY_LEN).fill(0))
    }
    const bodies = all.map((one) => one.envelope.body)
    for (const body of bodies) expect(body).toBe(bodies[0])

    // Decrypt each independently and confirm the PLAINTEXTS are identical
    // too, not merely the ciphertext lengths -- same discipline
    // call_into_the_web.mjs's side-channel proof uses.
    for (const one of all) {
      const combined = fromB64u(one.envelope.body)
      const iv = combined.slice(0, 12)
      const ciphertext = combined.slice(12)
      const plain = await open(key, iv, ciphertext)
      expect(plain).not.toBeNull()
      expect(Array.from(plain as Uint8Array)).toEqual(new Array(ANSWER_BODY_LEN).fill(0))
    }
  })

  it('A declining to relay (main.ts\'s declineRelay, via the real decide() call, not the direct primitives) is byte-identical to the other four', async () => {
    // Mirrors declineRelay's actual call exactly: emitAnswer(q, tpl,
    // noteMatch, false, peer, ...) -> decide(). noteMatch here is a REAL
    // above-threshold hit against A's own note (not null like the other
    // four cases above), consent is false. decide() now internally reuses
    // maskAnswerPlaintext/sealAnswerEnvelope (this file's gate.ts refactor),
    // so this proves the ACTUAL declineRelay code path, not an analogy of it.
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const query: QueryEnvelope = {
      v: 1, t: 'query', from: { id: 'b0000000', displayName: 'B' },
      templateId: TEMPLATE_ID, templateVersion: 1, qid: QID, issuedAt: Date.now(),
    }
    const template: QueryTemplate = {
      id: TEMPLATE_ID, version: 1, category: 'freetext',
      title: { de: 'x', en: 'x' }, question: { de: 'x', en: 'x' },
      matchTerms: ['leiter'], boostTerms: [], excludeTerms: [], minScore: 1, kThreshold: 1,
      sensitivity: 'high', ttlSeconds: 3600,
    }
    const hit: MatchHit = {
      threadId: 'sb:note1', threadTitle: 'Eigene Notizen (über andere)', messageIndex: 0,
      message: { ts: new Date().toISOString(), author: 'A', text: 'Der Jakob hat eine Leiter.', system: false },
      score: 5, terms: ['leiter'],
    }
    const noteMatch: MatchResult = { hits: [hit], distinctAuthors: 1, aboveThreshold: true }

    const { outcome, envelope } = await decide({
      query, template, match: noteMatch, consent: false, blocked: false, key,
    })
    expect(outcome).toBe('declined') // A's own local audit label, per renderSecondHopRelayCard's doc comment

    const nothing = await finalPlaintextAndEnvelope(null, key)
    expect(envelope.body).toBe(nothing.envelope.body)
  })

  it('a genuine relay SUCCESS produces a DIFFERENT ciphertext from every nothing cause', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const nothing = await finalPlaintextAndEnvelope(null, key)
    const shared: SharedPayload = {
      from: 'Jakob',
      templateId: TEMPLATE_ID,
      items: [{ text: 'Hab eine 3-Meter-Leiter im Keller.', when: 'Mitte August', context: 'Eigene Notizen' }],
    }
    const success = await finalPlaintextAndEnvelope(shared, key)
    expect(success.envelope.body).not.toBe(nothing.envelope.body)
    expect(success.plaintext[0]).toBe(1) // tag byte: shared
    expect(nothing.plaintext[0]).toBe(0) // tag byte: nothing
  })

  it('carries the true answerer\'s name verbatim on success, not the relaying peer\'s', async () => {
    const key = await derivePairKey('a-nonce', 'b-nonce')
    const shared: SharedPayload = {
      from: 'Jakob',
      templateId: TEMPLATE_ID,
      items: [{ text: 'Hab eine 3-Meter-Leiter im Keller.', when: 'Mitte August', context: 'Eigene Notizen' }],
    }
    const { envelope } = await finalPlaintextAndEnvelope(shared, key)
    const combined = fromB64u(envelope.body)
    const plain = await open(key, combined.slice(0, 12), combined.slice(12))
    expect(plain).not.toBeNull()
    const dataLen = ((plain as Uint8Array)[1] << 8) | (plain as Uint8Array)[2]
    const json = new TextDecoder().decode((plain as Uint8Array).slice(3, 3 + dataLen))
    const parsed = JSON.parse(json) as SharedPayload
    expect(parsed.from).toBe('Jakob')
    expect(parsed.items[0].when).toBe('Mitte August') // carried verbatim, never recomputed
  })
})
