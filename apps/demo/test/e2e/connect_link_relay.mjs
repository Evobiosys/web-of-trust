/**
 * Real end-to-end proof of the one-scan connect-link ceremony
 * (connect_link.ts) against the LIVE relay at questhub.eco -- did.ts,
 * relay.ts, wire.ts and connect_link.ts, run directly in Node (no browser,
 * so no CORS to work around -- same reason relay_query_answer.mjs and
 * relay_roundtrip.mjs in this directory are Node scripts rather than
 * Playwright: relay.ts's `send`/`sendRaw` are origin-locked by the relay's
 * own CORS policy, so a browser-driven version of this test would need a
 * page actually served from questhub.eco).
 *
 * What this proves, precisely:
 *
 *  1. The bootstrap message: "phone" builds a `connect-ack`
 *     (connect_link.ts's `buildConnectAck`) from its own did:peer:2 and
 *     sends it UNENCRYPTED via `sendRaw` to "laptop"'s DID (exactly as
 *     `completeConnectLinkIfPending` does in main.ts). "laptop" receives it
 *     via `onRawWire`, `decodeFromQr`s the cleartext payload back into the
 *     envelope, and it round-trips exactly.
 *  2. The real key agreement: BOTH sides independently compute
 *     `deriveEcdhPairKey(ecdhSharedSecret(myIdentity, theirDid))` and get
 *     the IDENTICAL AES-GCM key -- proven by actually encrypting on one
 *     side and decrypting on the other, not just comparing byte arrays.
 *  3. The security claim this feature exists to make honest: an
 *     "eavesdropper" identity that saw everything this script put on the
 *     wire (both DIDs, cleartext, via a real drain connection registered
 *     the same way "laptop"'s is) still cannot compute the same key --
 *     because doing so needs a PRIVATE key neither identity ever
 *     transmitted anywhere.
 *  4. The ceremony's actual payoff: once paired this way, an ordinary
 *     ENCRYPTED query/answer round trip (the same gate.decide/interpret
 *     path relay_query_answer.mjs proves for the two-scan ceremony) works
 *     identically over the resulting ECDH key.
 *
 * Run with tsx:
 *
 *   cd apps/demo && npx tsx test/e2e/connect_link_relay.mjs
 */
import { createIdentity, ecdhSharedSecret } from '../../src/did.ts'
import { createRelayChannel } from '../../src/relay.ts'
import { deriveEcdhPairKey } from '../../src/crypto.ts'
import { buildConnectAck } from '../../src/connect_link.ts'
import { decodeFromQr, encodeForQr } from '../../src/wire.ts'
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
  id: 'tmpl-housing-onescan-e2e',
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
    message: { ts: '2026-09-04T10:00:00Z', author: `author-${i}`, text: `Wohnung frei, Nachricht ${i}`, system: false },
    score: 5,
    terms: ['wohnung'],
  }))
  return { hits, distinctAuthors: hits.length, aboveThreshold }
}

async function main() {
  const t0 = Date.now()
  console.log(`connect_link_relay: targeting ${RELAY_ORIGIN}`)

  // "laptop" shows the connect link; "phone" opens it. "outsider" plays the
  // role of anyone who only ever sees what the relay sees -- both DIDs,
  // cleartext -- and tries to compute the same key from that alone.
  const laptop = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-laptop`)
  const phone = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-phone`)
  const outsider = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-outsider`)

  const laptopChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })
  const phoneChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })

  const statusLog = []
  laptopChannel.onStatus((status) => statusLog.push(`laptop:${status}`))
  phoneChannel.onStatus((status) => statusLog.push(`phone:${status}`))

  // ---- 1. Both devices come up on the relay, same as boot()'s
  //         initRelaySession()/bringUpRelayChannel would. ------------------
  await Promise.all([laptopChannel.connect(laptop), phoneChannel.connect(phone)])
  ok('both drains authenticated (onStatus fired connected for both)',
    statusLog.includes('laptop:connected') && statusLog.includes('phone:connected'))

  // ---- 2. The bootstrap message: phone -> laptop, UNENCRYPTED, exactly
  //         what completeConnectLinkIfPending() sends. --------------------
  const rawWiresSeenByLaptop = []
  laptopChannel.onRawWire((fromDid, payload) => rawWiresSeenByLaptop.push({ fromDid, payload }))

  const phonePersona = { id: 'phone0000', displayName: 'Phone-E2E' }
  const ack = buildConnectAck(phonePersona, phone)
  ok('buildConnectAck shape', ack.v === 1 && ack.t === 'connect-ack' && ack.did === phone.did)

  await phoneChannel.sendRaw(laptop.did, encodeForQr(ack))
  await waitFor(() => rawWiresSeenByLaptop.length >= 1, DELIVERY_TIMEOUT_MS)
  ok('laptop received exactly one raw wire from phone', rawWiresSeenByLaptop.length === 1)
  ok('the raw wire is attributed to phone\'s DID', rawWiresSeenByLaptop[0]?.fromDid === phone.did)

  const decodedAck = decodeFromQr(rawWiresSeenByLaptop[0].payload)
  ok('the cleartext payload decodes back to the exact ConnectAckEnvelope', JSON.stringify(decodedAck) === JSON.stringify(ack))
  ok('decodedAck.did matches the outer wire\'s cleartext from (the check main.ts\'s handleRawWire also makes)',
    decodedAck?.did === rawWiresSeenByLaptop[0].fromDid)

  // ---- 3. Real key agreement: both sides derive the identical key from
  //         PUBLIC information only (each other's did:peer:2). -----------
  const laptopKey = await deriveEcdhPairKey(ecdhSharedSecret(laptop, phone.did))
  const phoneKey = await deriveEcdhPairKey(ecdhSharedSecret(phone, laptop.did))

  // ---- 4. The security claim: an outsider limited to what the relay saw
  //         (both DIDs, cleartext -- exactly what onRawWire above just
  //         demonstrated the relay's own view contains) cannot compute the
  //         same key, because that needs a PRIVATE key never transmitted. --
  const outsiderGuess = ecdhSharedSecret(outsider, phone.did)
  ok('an outsider with only public DIDs derives a DIFFERENT shared secret than the real pair',
    Buffer.from(outsiderGuess).toString('hex') !== Buffer.from(ecdhSharedSecret(laptop, phone.did)).toString('hex'))

  // ---- 5. The payoff: an ordinary encrypted query/answer round trip over
  //         the ECDH key, live, exactly as relay_query_answer.mjs proves
  //         for the two-scan ceremony's derivePairKey. --------------------
  const query = {
    v: 1,
    t: 'query',
    from: phonePersona,
    templateId: TEMPLATE.id,
    templateVersion: TEMPLATE.version,
    qid: `qid-onescan-e2e-${Math.random().toString(36).slice(2, 10)}`,
    issuedAt: Date.now(),
  }

  const laptopQueries = []
  laptopChannel.onEnvelope(laptopKey, (envelope, fromDid) => {
    if (envelope.t === 'query') laptopQueries.push({ envelope, fromDid })
  })
  const phoneAnswers = []
  phoneChannel.onEnvelope(phoneKey, (envelope) => {
    if (envelope.t === 'answer' && envelope.qid === query.qid) phoneAnswers.push(envelope)
  })

  await phoneChannel.send(laptop.did, query, phoneKey)
  await waitFor(() => laptopQueries.length >= 1, DELIVERY_TIMEOUT_MS)
  ok('laptop received the query, decrypted under the ECDH-derived key', laptopQueries.length === 1)
  ok('the query is attributed to phone\'s DID', laptopQueries[0]?.fromDid === phone.did)

  const { outcome, envelope: answer } = await decide({
    query, template: TEMPLATE, match: makeMatch(3, true), consent: true, blocked: false, key: laptopKey,
  })
  ok('gate outcome really is "shared"', outcome === 'shared')

  await laptopChannel.send(phone.did, answer, laptopKey)
  await waitFor(() => phoneAnswers.length >= 1, DELIVERY_TIMEOUT_MS)
  ok('phone received the answer, decrypted under the ECDH-derived key', phoneAnswers.length === 1)

  const decoded = await interpret(phoneAnswers[0], phoneKey)
  ok('phone decodes outcome "shared"', decoded.outcome === 'shared')
  ok('phone sees the shared items', (decoded.shared?.items?.length ?? 0) > 0)

  laptopChannel.close()
  phoneChannel.close()

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
  console.error('connect_link_relay: uncaught error:', err)
  process.exit(1)
})
