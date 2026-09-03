/**
 * Real round trip against the LIVE relay at questhub.eco (no local server,
 * no mock -- handover-relay-did.md Task 3's e2e proof). Mints two browser
 * identities, connects both to `wss://questhub.eco/relay/drain`, sends a
 * QueryEnvelope Nora -> Marlene and an AnswerEnvelope Marlene -> Nora, and
 * asserts both arrive decrypted and byte-identical to what was sent.
 *
 * This exercises the demo's actual production code path -- did.ts, relay.ts,
 * crypto.ts, wire.ts -- run directly in Node (not a browser): Node >= 22
 * ships a native `WebSocket` and `fetch`, and Node's `crypto.subtle` is the
 * same WebCrypto `SubtleCrypto` the browser exposes, so no shimming is
 * needed (root package.json's `engines` already requires Node >= 20; this
 * script additionally needs the native WebSocket, stable since Node 22).
 *
 * Run with tsx (already a workspace devDependency, see Makefile's existing
 * `pnpm tsx scripts/*.ts` convention) so the extension-less relative
 * imports inside src/*.ts resolve exactly as they do under Vite:
 *
 *   cd apps/demo && npx tsx test/e2e/relay_roundtrip.mjs
 *
 * Exits non-zero on any failed assertion or timeout (>15s waiting for a
 * delivery), so it is CI/script-friendly. Keeps well under the 20s budget
 * the handover asks for -- see the printed timings.
 */
import { createIdentity, signChallenge } from '../../src/did.ts'
import { createRelayChannel } from '../../src/relay.ts'
import { derivePairKey } from '../../src/crypto.ts'

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

async function main() {
  const t0 = Date.now()
  console.log(`relay_roundtrip: targeting ${RELAY_ORIGIN}`)

  // Two "already paired" devices: the QR ceremony already happened, so both
  // sides already hold the same pair key. did:peer:2 identities are freshly
  // minted here purely to have something for the RELAY to route on and
  // authenticate the drain with -- unrelated to the pair key.
  const nora = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-nora`)
  const marlene = createIdentity(`${RELAY_ORIGIN}/pending-relay-did-marlene`)
  const pairKey = await derivePairKey('nora-nonce-e2e', 'marlene-nonce-e2e')

  ok('signChallenge produces a signature distinct from the nonce (sanity)', (() => {
    const nonce = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    return signChallenge(nora, nonce) !== nonce
  })())

  const noraChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })
  const marleneChannel = createRelayChannel({ relayOrigin: RELAY_ORIGIN })

  const noraReceived = []
  const marleneReceived = []
  noraChannel.onEnvelope(pairKey, (envelope, fromDid) => noraReceived.push({ envelope, fromDid }))
  marleneChannel.onEnvelope(pairKey, (envelope, fromDid) => marleneReceived.push({ envelope, fromDid }))

  const tConnectStart = Date.now()
  await Promise.all([marleneChannel.connect(marlene), noraChannel.connect(nora)])
  const connectMs = Date.now() - tConnectStart
  console.log(`  both drains authenticated in ${connectMs}ms`)
  ok('both connect() calls resolved (auth_ok on both drains)', true)

  // ---- Nora asks Marlene ---------------------------------------------
  const query = {
    v: 1,
    t: 'query',
    from: { id: 'nora0000', displayName: 'Nora' },
    templateId: 'tmpl-housing-1',
    templateVersion: 1,
    qid: `qid-e2e-${Date.now()}`,
    issuedAt: Date.now(),
  }

  const tSendQuery = Date.now()
  await noraChannel.send(marlene.did, query, pairKey)
  await waitFor(() => marleneReceived.length >= 1, DELIVERY_TIMEOUT_MS)
  const queryRoundTripMs = Date.now() - tSendQuery
  console.log(`  query delivered nora -> marlene in ${queryRoundTripMs}ms`)

  ok('marlene received exactly one envelope', marleneReceived.length === 1, `got ${marleneReceived.length}`)
  ok(
    'the delivered query is byte-identical to what nora sent',
    JSON.stringify(marleneReceived[0]?.envelope) === JSON.stringify(query)
  )
  ok('the delivered query is attributed to nora\'s DID', marleneReceived[0]?.fromDid === nora.did)

  // ---- Marlene answers back ------------------------------------------
  const answer = { v: 1, t: 'answer', qid: query.qid, body: 'y'.repeat(512) }

  const tSendAnswer = Date.now()
  await marleneChannel.send(nora.did, answer, pairKey)
  await waitFor(() => noraReceived.length >= 1, DELIVERY_TIMEOUT_MS)
  const answerRoundTripMs = Date.now() - tSendAnswer
  console.log(`  answer delivered marlene -> nora in ${answerRoundTripMs}ms`)

  ok('nora received exactly one envelope', noraReceived.length === 1, `got ${noraReceived.length}`)
  ok(
    'the delivered answer is byte-identical to what marlene sent',
    JSON.stringify(noraReceived[0]?.envelope) === JSON.stringify(answer)
  )
  ok('the delivered answer is attributed to marlene\'s DID', noraReceived[0]?.fromDid === marlene.did)

  noraChannel.close()
  marleneChannel.close()

  const totalMs = Date.now() - t0
  console.log(`\nTotal wall time: ${totalMs}ms (connect ${connectMs}ms, query ${queryRoundTripMs}ms, answer ${answerRoundTripMs}ms)`)

  if (failures > 0) {
    console.log(`\n${failures} assertion(s) FAILED`)
    process.exit(1)
  }
  console.log('\nAll assertions passed.')
  process.exit(0)
}

main().catch((err) => {
  console.error('relay_roundtrip: uncaught error:', err)
  process.exit(1)
})
