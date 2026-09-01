/**
 * THE central privacy contract of the demo.
 *
 * B asks A a templated question. A's device matches locally. A is asked only
 * "are you willing to share what you have? yes / no". B must learn EXACTLY
 * ONE BIT: `shared` or `nothing`.
 *
 * Four internal reasons collapse to `nothing`: `no-match`, `below-k`,
 * `declined`, `blocked`. Those four MUST be indistinguishable to B --
 * byte-identical envelopes and indistinguishable timing. See
 * test/gate_identity.test.ts and test/gate_timing.test.ts, which enforce
 * exactly this.
 *
 * How byte-identity is achieved (read this before changing anything below):
 *
 *  1. Every path builds a plaintext buffer of EXACTLY ANSWER_BODY_LEN bytes,
 *     unconditionally, using the SAME construction:
 *       [0]        tag byte: 0x00 = nothing, 0x01 = shared
 *       [1..3)     big-endian uint16: length of the JSON payload (0 if none)
 *       [3..3+n)   UTF-8 JSON of the (possibly truncated) SharedPayload
 *       [3+n..end) padding
 *  2. The "what would we share" JSON is built from `match.hits` on EVERY
 *     call, regardless of `blocked`/`consent`/`aboveThreshold`. This is the
 *     part that closes the timing side channel: if we only serialised the
 *     payload when actually sharing, `below-k` (many hits, but under
 *     threshold) would be cheaper than `shared` (many hits) purely because
 *     of when the JSON work happens, and `no-match` (zero hits) would be
 *     cheaper still. Doing the work every time makes CPU cost a function of
 *     `match.hits.length` alone, not of the outcome.
 *  3. The final plaintext is chosen from the two fully-built candidates
 *     (`sharedPlain`, `nothingPlain`) with a byte-wise mask, not an
 *     `if (outcome === 'shared') {...} else {...}` on the buffer itself.
 *     There is exactly one boolean branch in this file that affects plaintext
 *     content (`wouldShare`), and all four `nothing` reasons evaluate it
 *     identically to `false` -- they never branch against EACH OTHER.
 *  4. AES-GCM is deterministic for a fixed (key, iv, plaintext) triple. Fixed
 *     key + fixed iv + byte-identical plaintext therefore gives byte-identical
 *     ciphertext, by construction, not by hoping the test never catches a
 *     divergence.
 */

import { ivFromQid, open, seal, toB64u, fromB64u } from './crypto'
import type {
  AnswerEnvelope,
  DecodedAnswer,
  LocalOutcome,
  MatchResult,
  QueryEnvelope,
  QueryTemplate,
  SharedItem,
  SharedPayload,
} from './types'
import { ANSWER_BODY_LEN } from './types'

export interface GateInput {
  query: QueryEnvelope
  template: QueryTemplate
  match: MatchResult
  /** What A tapped. */
  consent: boolean
  /** A has blocked this requester. */
  blocked: boolean
  key: CryptoKey
}

/**
 * The wire payload is SharedPayload plus one optional truncation flag. This
 * widens the type locally rather than editing types.ts (owned elsewhere).
 * `tr: 1` means the item list was cut short to fit ANSWER_BODY_LEN; the UI
 * layer can use it to render "und weitere" (and more). A value returned from
 * `interpret()` is typed as `SharedPayload` (per the DecodedAnswer contract)
 * but the actual object still carries `tr` at runtime -- callers that care
 * can read it via a local cast to WirePayload.
 */
export type WirePayload = SharedPayload & { tr?: 1 }

/**
 * Demo machine-time equalisation budget. `decide()` itself is not gated by
 * this -- callers await `settleAt(t0, GATE_BUDGET_MS)` after `decide()`
 * resolves, so that the total wall-clock time from "user tapped yes/no" (or
 * from whenever the caller starts the clock) to "envelope goes out" is the
 * same regardless of which branch fired.
 */
export const GATE_BUDGET_MS = 900

const HEADER_LEN = 3 // tag byte + 2-byte length
const MAX_PAYLOAD_BYTES = ANSWER_BODY_LEN - HEADER_LEN

// ---------------------------------------------------------------------------
// Payload construction
// ---------------------------------------------------------------------------

/** Coarse, human, deliberately imprecise date label ("Mitte August"). */
function coarseWhen(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'unbekanntes Datum'
  const months = [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ]
  const day = d.getDate()
  const segment = day <= 10 ? 'Anfang' : day <= 20 ? 'Mitte' : 'Ende'
  return `${segment} ${months[d.getMonth()]}`
}

/**
 * Build the JSON bytes for "what A would share if allowed", truncating the
 * item list until it fits in MAX_PAYLOAD_BYTES. Called unconditionally on
 * every `decide()` invocation -- see the module doc comment.
 *
 * NOTE / known gap: SharedPayload.from should identify the answering device
 * (A), but GateInput carries no identity for A (only `query.from`, which is
 * B, the asker). Left as an empty string rather than guessing wrong; a real
 * build should add an `identity: Identity` field to GateInput and thread it
 * through here.
 */
function buildSharedJsonBytes(input: GateInput): Uint8Array {
  const items: SharedItem[] = input.match.hits.map((hit) => ({
    text: hit.message.text,
    when: coarseWhen(hit.message.ts),
    context: hit.threadTitle,
  }))

  // Encode each item once, then binary-search the largest prefix that still
  // fits MAX_PAYLOAD_BYTES once wrapped in the envelope. This is called
  // unconditionally on every decide() (see module doc) -- with a naive
  // "re-JSON.stringify the whole array, decrement n by one, repeat" loop
  // this was O(hits^2) and made decide() cost blow up for a large candidate
  // set (which is exactly the case `below-k`, `declined`, `blocked` and
  // `shared` are supposed to cost the SAME as each other for). Building the
  // wrapper by hand from pre-encoded item strings keeps this O(hits log hits).
  const itemJsons = items.map((it) => JSON.stringify(it))
  const templateIdJson = JSON.stringify(input.template.id)

  const encodeWith = (n: number): Uint8Array => {
    const truncated = n < items.length
    const json =
      `{"from":"","templateId":${templateIdJson},"items":[` +
      itemJsons.slice(0, n).join(',') +
      ']' +
      (truncated ? ',"tr":1' : '') +
      '}'
    return new TextEncoder().encode(json)
  }

  let lo = 0
  let hi = items.length
  let best = encodeWith(0)
  if (best.length > MAX_PAYLOAD_BYTES) {
    // Pathological fallback: even zero items don't fit (huge templateId).
    // Truncating raw bytes here can produce invalid JSON; interpret() handles
    // that the same way it handles any other malformed payload -- by
    // returning {outcome:'nothing'}. This never affects envelope size.
    return best.slice(0, MAX_PAYLOAD_BYTES)
  }
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const candidate = encodeWith(mid)
    if (candidate.length <= MAX_PAYLOAD_BYTES) {
      best = candidate
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

function buildPlain(tag: 0 | 1, jsonBytes: Uint8Array): Uint8Array {
  const buf = new Uint8Array(ANSWER_BODY_LEN)
  buf[0] = tag
  buf[1] = (jsonBytes.length >> 8) & 0xff
  buf[2] = jsonBytes.length & 0xff
  buf.set(jsonBytes, HEADER_LEN)
  const padStart = HEADER_LEN + jsonBytes.length
  const padLen = ANSWER_BODY_LEN - padStart
  if (padLen > 0) buf.fill(padLen & 0xff, padStart)
  return buf
}

// ---------------------------------------------------------------------------
// decide / interpret
// ---------------------------------------------------------------------------

export async function decide(
  input: GateInput,
  /**
   * Test-only: force the AES-GCM IV instead of deriving it from `qid`. Used
   * by gate_identity.test.ts to make envelope comparisons deterministic
   * across separate `decide()` calls without relying on Date.now()/qid
   * plumbing. Never pass this from production code.
   */
  ivOverride?: Uint8Array,
): Promise<{ outcome: LocalOutcome; envelope: AnswerEnvelope }> {
  const { match, consent, blocked } = input

  const wouldShare = !blocked && match.aboveThreshold && consent

  const outcome: LocalOutcome = blocked
    ? 'blocked'
    : match.hits.length === 0
      ? 'no-match'
      : !match.aboveThreshold
        ? 'below-k'
        : !consent
          ? 'declined'
          : 'shared'

  // Always do the full "what would we share" work -- see module doc.
  const jsonBytes = buildSharedJsonBytes(input)
  const sharedPlain = buildPlain(1, jsonBytes)
  const nothingPlain = new Uint8Array(ANSWER_BODY_LEN) // all-zero: tag 0, len 0, pad 0

  const maskByte = wouldShare ? 0xff : 0x00
  const invMaskByte = (~maskByte) & 0xff
  const plaintext = new Uint8Array(ANSWER_BODY_LEN)
  for (let i = 0; i < ANSWER_BODY_LEN; i++) {
    plaintext[i] = (sharedPlain[i] & maskByte) | (nothingPlain[i] & invMaskByte)
  }

  const iv = ivOverride ?? (await ivFromQid(input.query.qid))
  const ciphertext = await seal(input.key, iv, plaintext)

  const combined = new Uint8Array(iv.length + ciphertext.length)
  combined.set(iv, 0)
  combined.set(ciphertext, iv.length)

  const envelope: AnswerEnvelope = {
    v: 1,
    t: 'answer',
    qid: input.query.qid,
    body: toB64u(combined),
  }

  return { outcome, envelope }
}

const IV_LEN = 12

export async function interpret(env: AnswerEnvelope, key: CryptoKey): Promise<DecodedAnswer> {
  try {
    const combined = fromB64u(env.body)
    if (combined.length <= IV_LEN) return { outcome: 'nothing' }
    const iv = combined.slice(0, IV_LEN)
    const ciphertext = combined.slice(IV_LEN)

    const plaintext = await open(key, iv, ciphertext)
    if (plaintext === null || plaintext.length !== ANSWER_BODY_LEN) {
      return { outcome: 'nothing' }
    }

    if (plaintext[0] !== 1) return { outcome: 'nothing' }

    const dataLen = (plaintext[1] << 8) | plaintext[2]
    if (dataLen < 0 || HEADER_LEN + dataLen > ANSWER_BODY_LEN) {
      return { outcome: 'nothing' }
    }

    const jsonBytes = plaintext.slice(HEADER_LEN, HEADER_LEN + dataLen)
    const parsed: unknown = JSON.parse(new TextDecoder().decode(jsonBytes))

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as WirePayload).from !== 'string' ||
      typeof (parsed as WirePayload).templateId !== 'string' ||
      !Array.isArray((parsed as WirePayload).items)
    ) {
      return { outcome: 'nothing' }
    }

    const p = parsed as WirePayload
    const shared: WirePayload = {
      from: p.from,
      templateId: p.templateId,
      items: p.items,
      ...(p.tr === 1 ? { tr: 1 } : {}),
    }
    return { outcome: 'shared', shared }
  } catch {
    return { outcome: 'nothing' }
  }
}

// ---------------------------------------------------------------------------
// Machine-time equalisation
// ---------------------------------------------------------------------------

/**
 * Resolves at exactly `t0 + budgetMs` (or immediately, if that instant has
 * already passed). Call this AFTER `decide()` resolves, timing the whole
 * span from whenever the caller wants to equalise from (e.g. the moment A
 * tapped yes/no):
 *
 *   const t0 = Date.now()
 *   const { outcome, envelope } = await decide(input)
 *   await settleAt(t0, GATE_BUDGET_MS)
 *   sendEnvelope(envelope)
 *
 * This equalises *machine* time only -- the CPU/crypto work `decide()` does.
 * It does NOT and CANNOT remove the residual side channel of *human*
 * deliberation time: how long A visibly takes to look at the prompt and tap
 * yes/no before the clock in the caller even starts, or how long between
 * "query received" and "user opened the app" if that gap is observable to B.
 * Do not present this function as closing that gap; it does not.
 */
export function settleAt(t0: number, budgetMs: number): Promise<void> {
  const target = t0 + budgetMs
  const remaining = target - Date.now()
  if (remaining <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, remaining))
}
