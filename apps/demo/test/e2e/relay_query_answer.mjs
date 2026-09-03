/**
 * Real end-to-end proof of demo 2's actual production path -- did.ts,
 * relay.ts, crypto.ts, wire.ts, AND gate.ts -- run directly in Node against
 * the LIVE relay at questhub.eco. relay_roundtrip.mjs (this directory)
 * already proves the transport carries an arbitrary envelope unmodified;
 * this script goes one step further and drives the actual privacy-bearing
 * flow demo2-relay-ui.md asks for: Nora sends a real QueryEnvelope, Marlene
 * runs it through gate.decide() exactly as main.ts's emitAnswer() does (once
 * for a SHARE, once for a DECLINE, same question), sends the resulting
 * AnswerEnvelope back over the relay, and Nora runs it through
 * gate.interpret() exactly as main.ts's askOverRelay() does.
 *
 * It also re-proves the wire-level privacy invariant (relay.test.ts's unit
 * test) against envelopes that actually crossed the live relay: the
 * encrypted payload length Marlene's channel sends is identical whether she
 * shares or declines, for the same question.
 *
 * Run with tsx, same convention as relay_roundtrip.mjs:
 *
 *   cd apps/demo && npx tsx test/e2e/relay_query_answer.mjs
 */
import { createIdentity, signChallenge } from '../../src/did.ts'
import { createRelayChannel, encryptEnvelope } from '../../src/relay.ts'
import { derivePairKey } from '../../src/crypto.ts'
import { decide, interpret } from '../../src/gate.ts'

const RELAY_ORIGIN = process.env.RELAY_ORIGIN || 'https://questhub.eco'
const DELIVERY_TIMEOUT_MS = 15_000

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`)
  }
}

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = () => {
      if (predicate()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error(`waitFor: timed out after ${timeoutMs}ms`))
      setTimeout(poll, 25)
    }
    poll()
  })
}

const TEMPLATE = {
  id: 'tmpl-housing-e2e',
  version: 1,
  category: 'housing',
  title: { de: 'Wohnung', en: 'Housing' },
  question: { de: 'Suchst du eine Wohnung?', en: 'Looking for housing?' },
  matchTerms: ['wohnung'],
  boostTerms: [],
  excludeTerms: [],
  minScore: 1,
  kThreshold: 2,
  sensitivity: 'medium',
  ttlSeconds: 3600,
}

function makeMatch(hitCount, aboveThreshold) {
  const hits = Array.from({ length: hitCount }, (_, i) => ({
    threadId: `thread-${i}`,
    threadTitle: `Gruppe ${i}`,
    messageIndex: i,
    message: { ts: '2026-08-15T10:00:00Z', author: `author-${i}`, text: `Wohnung frei, Nachricht ${i}`, system: false },
    score: 5,
    terms: ['wohnung'],
  }))
  return { hits, distinctAuthors: hits.length, aboveThreshold }
}

/** One asked-and-answered round trip over the LIVE relay. Returns the
 *  outer-wire payload length Marlene's channel sent, for the cross-case
 *  length comparison below. */
async function askAndAnswer(label, { noraChannel, marleneChannel, nora, marlene, pairKey }, { consent, match }) {
  // qid is intentionally the SAME LENGTH regardless of `label` -- real qids
  // are randomId(12), fixed length by construction (crypto.ts). Baking
  // `label` into the qid string here would itself vary the AnswerEnvelope's
  // JSON length between cases and produce a false failure below that has
  // nothing to do with the invariant being tested (caught by running this
  // once with the label embedded: it fails, correctly, on a bug in the test
  // fixture, not in gate.ts/relay.ts).
  const query = {
    v: 1,
    t: 'query',
    from: { id: 'nora0000', displayName: 'Nora' },
    templateId: TEMPLATE.id,
    templateVersion: TEMPLATE.version,
    qid: `qid-${Math.random().toString(36).slice(2, 14).padEnd(12, '0')}`,
    issuedAt: Date.now(),
  }

  const marleneQueries = []
  marleneChannel.onEnvelope(pairKey, (envelope, fromDid) => {
    if (envelope.t === 'query') marleneQueries.push({ envelope, fromDid })
  })

  const noraAnswers = []
  noraChannel.onEnvelope(pairKey, (envelope) => {
    if (envelope.t === 'answer' && envelope.qid === query.qid) noraAnswers.push(envelope)
  })

  await noraChannel.send(marlene.did, query, pairKey)
  await waitFor(() => marleneQueries.length >= 1, DELIVERY_TIMEOUT_MS)
  ok(`[${label}] Marlene received the query over the relay`, marleneQueries.length === 1)
  ok(`[${label}] the query is attributed to Nora's DID`, marleneQueries[0]?.fromDid === nora.did)

  // Exactly what main.ts's emitAnswer() does: decide() unconditionally, then
  // send the result -- gate.ts's byte-padding is what makes this safe to do
  // identically regardless of `consent`/`match`.
  const { outcome, envelope: answer } = await decide({
    query, template: TEMPLATE, match, consent, blocked: false, key: pairKey,
  })
  const outerPayloadLen = (await encryptEnvelope(answer, pairKey)).length

  await marleneChannel.send(nora.did, answer, pairKey)
  await waitFor(() => noraAnswers.length >= 1, DELIVERY_TIMEOUT_MS)
  ok(`[${label}] Nora received the answer over the relay`, noraAnswers.length === 1)

  const decoded = await interpret(noraAnswers[0], pairKey)
  return { outcome, decoded, outerPayloadLen }
}

async function main() {
  const t0 = Date.now()
  console.log(`relay_query_answer: targeting ${RELAY_ORIGIN}`)

  const nora = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-nora`)
  const marlene = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-marlene`)
  const pairKey = await derivePairKey('nora-nonce-e2e-qa', 'marlene-nonce-e2e-qa')

  ok('signChallenge produces a signature distinct from the nonce (sanity)', (() => {
    const nonce = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    return signChallenge(nora, nonce) !== nonce
  })())

  const noraChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })
  const marleneChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })

  const statusLog = []
  noraChannel.onStatus((status) => statusLog.push(`nora:${status}`))
  marleneChannel.onStatus((status) => statusLog.push(`marlene:${status}`))

  await Promise.all([marleneChannel.connect(marlene), noraChannel.connect(nora)])
  ok('both drains authenticated (onStatus fired connected for both)',
    statusLog.includes('nora:connected') && statusLog.includes('marlene:connected'))

  const ctx = { noraChannel, marleneChannel, nora, marlene, pairKey }

  // ---- Case 1: Marlene shares --------------------------------------------
  const shared = await askAndAnswer('shared', ctx, { consent: true, match: makeMatch(3, true) })
  ok('[shared] gate outcome really is "shared"', shared.outcome === 'shared')
  ok('[shared] Nora decodes outcome "shared"', shared.decoded.outcome === 'shared')
  ok('[shared] Nora sees the shared items', (shared.decoded.shared?.items?.length ?? 0) > 0)

  // ---- Case 2: Marlene declines, same question shape ---------------------
  const declined = await askAndAnswer('declined', ctx, { consent: false, match: makeMatch(3, true) })
  ok('[declined] gate outcome really is "declined"', declined.outcome === 'declined')
  ok('[declined] Nora decodes outcome "nothing"', declined.decoded.outcome === 'nothing')

  // ---- The wire-level privacy invariant, proven against envelopes that
  //      actually crossed the live relay, not just the local unit test. ----
  ok(
    'the outer-wire payload length Marlene sent is identical for shared vs declined',
    shared.outerPayloadLen === declined.outerPayloadLen,
    `${shared.outerPayloadLen} vs ${declined.outerPayloadLen}`,
  )

  noraChannel.close()
  marleneChannel.close()

  const totalMs = Date.now() - t0
  console.log(`\nTotal wall time: ${totalMs}ms`)

  if (failures > 0) {
    console.log(`\n${failures} assertion(s) FAILED`)
    process.exit(1)
  }
  console.log('\nAll assertions passed.')
  process.exit(0)
}

main().catch((err) => {
  console.error('relay_query_answer: uncaught error:', err)
  process.exit(1)
})
