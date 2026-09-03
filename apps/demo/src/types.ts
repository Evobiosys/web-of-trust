/**
 * Shared data contract for the Web-of-Trust demo.
 *
 * Everything here is pure data. No DOM, no IndexedDB, no network. Keep it that
 * way so the matcher, the parser and the gate can be unit-tested in isolation.
 */

// ---------------------------------------------------------------------------
// Imported chat material
// ---------------------------------------------------------------------------

export type ChatSource =
  | 'whatsapp-ios'
  | 'whatsapp-android'
  | 'signal-desktop'
  | 'telegram-json'
  | 'seed'
  /**
   * Not an import: a thread synthesized from an inventory entry she typed
   * in herself. See state.ts's inventoryThreads(). Kept distinct from
   * 'seed' so a source dump never mislabels her own words as demo fixture
   * data.
   */
  | 'self'

export interface ChatMessage {
  /** ISO-8601 local timestamp as parsed from the export. */
  ts: string
  author: string
  text: string
  /** True for join/leave/encryption notices and other non-human lines. */
  system: boolean
}

export type ThreadKind = 'group' | 'direct'

export interface ChatThread {
  id: string
  title: string
  kind: ThreadKind
  participants: string[]
  messages: ChatMessage[]
  source: ChatSource
  /**
   * Whether this thread is in scope for queries.
   * Groups default to true, 1-on-1 threads default to FALSE: the user opts in
   * to direct conversations, never the other way round.
   */
  included: boolean
}

// ---------------------------------------------------------------------------
// Profile: who this person is, local to their own device
// ---------------------------------------------------------------------------

/**
 * A person's own profile. Lives in DeviceState, same as `threads` and
 * `inventory`, and is subject to the identical rule: nothing here reaches a
 * requester except through the existing Gate-2 consent step in gate.ts. This
 * demo build does not surface any profile field in an AnswerEnvelope at all
 * -- see gate.ts's GateInput, which has no `profile` field to plumb one
 * through, and test/gate_profile_privacy.test.ts, which pins that shut.
 */
export interface Profile {
  displayName: string
  /** "Was mich ausmacht" -- a short self-description, in her own words. */
  bio: string
  /** Grätzl / neighbourhood, e.g. "Ottakring". Free text, not a picklist. */
  neighbourhood: string
  languages: string[]
}

// ---------------------------------------------------------------------------
// Her own inventory: things she has, knows or can offer, typed in herself
// ---------------------------------------------------------------------------

export interface InventoryItem {
  id: string
  text: string
  /** ISO-8601 local timestamp of when she typed it in. */
  createdAt: string
  /**
   * Whether this entry is in scope for matching. Defaults to TRUE when a
   * new entry is created (see state.ts's addInventoryItem) -- the opposite
   * default from ChatThread.included on a 1-on-1 thread below, and
   * deliberately so: a 1-on-1 chat's content originates with someone else
   * and she is opting IN to exposing it, whereas an inventory entry is
   * something she sat down and typed on purpose, so it starts visible.
   */
  included: boolean
}

// ---------------------------------------------------------------------------
// Query templates
// ---------------------------------------------------------------------------

export type Sensitivity = 'low' | 'medium' | 'high'

export interface QueryTemplate {
  id: string
  version: number
  category: string
  title: { de: string; en: string }
  /** The question as a person would actually ask it. */
  question: { de: string; en: string }
  /**
   * Lowercased, de-umlauted match terms. A term containing a space is matched
   * as a phrase; otherwise it is matched against stemmed tokens.
   */
  matchTerms: string[]
  /** Terms that make a hit much more likely to be a real lead. */
  boostTerms: string[]
  /** Terms that veto a message even if it matched (e.g. "suche" for an offer query). */
  excludeTerms: string[]
  /** Minimum score for a message to count as a candidate hit. */
  minScore: number
  /**
   * Minimum number of DISTINCT AUTHORS who must have said something matching
   * before anything may be offered.
   *
   * Authors, not messages. Counting messages does not anonymise anybody: seven
   * messages from one neighbour clear a floor of seven and all seven are hers,
   * so the floor that is supposed to protect the most exposed person in the
   * chat protects nobody. Enforced by match/lexical.ts and asserted in
   * test/match_kanon.test.ts.
   */
  kThreshold: number
  sensitivity: Sensitivity
  ttlSeconds: number
}

// ---------------------------------------------------------------------------
// Matching (runs only on the answering device, never leaves it)
// ---------------------------------------------------------------------------

export interface MatchHit {
  threadId: string
  threadTitle: string
  messageIndex: number
  message: ChatMessage
  score: number
  /** Which match/boost terms fired. For the "what exactly would I share" screen. */
  terms: string[]
}

export interface MatchResult {
  hits: MatchHit[]
  /**
   * How many DISTINCT people wrote the hits, counting only hits that clear the
   * relevance bar. This is the number the anonymity floor is compared against.
   */
  distinctAuthors: number
  /** True when distinctAuthors >= template.kThreshold. */
  aboveThreshold: boolean
}

// ---------------------------------------------------------------------------
// The wire protocol (QR payloads)
// ---------------------------------------------------------------------------

export const WIRE_VERSION = 1

export interface Identity {
  /** Short stable id, 8 chars. */
  id: string
  displayName: string
}

/** QR 1: the connection ceremony. */
export interface ConnectEnvelope {
  v: 1
  t: 'connect'
  from: Identity
  /** Random, binds the pair. */
  nonce: string
  /**
   * OPTIONAL: sender's did:peer:2 (did.ts), present only in relay-mode
   * builds (mode.ts). A demo-1 (qr-mode) connect code never carries this
   * field, and `decodeFromQr` must still parse a code that lacks it -- the
   * whole point of making it optional is that qr-mode's wire is unchanged.
   * The peer's did is how relay.ts's `send()` addresses them once paired;
   * see state.ts's `Peer.did`.
   */
  did?: string
}

/** QR 2: B asks. Carries the template id and the nonce, never free text. */
export interface QueryEnvelope {
  v: 1
  t: 'query'
  from: Identity
  templateId: string
  templateVersion: number
  /** Unique per ask. Also the AEAD nonce for the answer. */
  qid: string
  issuedAt: number
}

/**
 * QR 3: A answers.
 *
 * THE CENTRAL PRIVACY CONTRACT.
 *
 * There are exactly two outcomes visible to the asker: `nothing` and `shared`.
 * The four internal reasons for `nothing` -- no match, below k, declined,
 * blocked -- MUST produce byte-identical envelopes. The only field that may
 * vary is `body`, which is fixed-length in both cases.
 *
 * Enforced by test/gate_identity.test.ts. Do not add a field to this type
 * without adding it to that test.
 */
export interface AnswerEnvelope {
  v: 1
  t: 'answer'
  /** Echoes QueryEnvelope.qid. */
  qid: string
  /** Fixed-length. Opaque. Padded to ANSWER_BODY_LEN in every case. */
  body: string
}

export const ANSWER_BODY_LEN = 512

/** Reasons live only on the answering device. They are never serialised. */
export type LocalOutcome = 'no-match' | 'below-k' | 'declined' | 'blocked' | 'shared'

/** What the asking device is allowed to learn. */
export type VisibleOutcome = 'nothing' | 'shared'

export interface DecodedAnswer {
  outcome: VisibleOutcome
  /** Present only when outcome === 'shared'. */
  shared?: SharedPayload
}

export interface SharedPayload {
  from: string
  templateId: string
  items: SharedItem[]
}

export interface SharedItem {
  /** The message text as it stood in the chat. Messy on purpose. */
  text: string
  /** Coarse date only: "Mitte August" rather than a timestamp. */
  when: string
  /** Which group it came from, or 'eine Gruppe' if the user chose to blur it. */
  context: string
}
