/**
 * Core domain types for the EW web-of-trust prototype.
 * Source of truth in prose: docs/20-data-contract.md (anchor IDs in braces).
 * Open mechanism decisions live in docs/30-architecture-decisions.md (ADR-n).
 */

export type PersonId = string;

/** {ONB-*, CER-1, CER-4} The trust ladder. Ordered: contact < friend < close. */
export type Level = "contact" | "friend" | "close";
export const LEVEL_ORDER: Record<Level, number> = { contact: 0, friend: 1, close: 2 };
export const LEVEL_LABEL: Record<Level, string> = {
  contact: "Contact",
  friend: "Friend",
  close: "Close friend",
};

/** {HST-2, DIS-3} Event/offer visibility tiers. */
export type Tier = "public" | "commons" | "friends" | "close";
export const TIER_LABEL: Record<Tier, string> = {
  public: "Public",
  commons: "The Commons",
  friends: "Friends",
  close: "Close friends",
};
/** Minimum effective level every hop must satisfy for a gated tier. */
export const TIER_MIN_LEVEL: Record<Exclude<Tier, "public">, Level> = {
  commons: "contact",
  friends: "friend",
  close: "close",
};

/** {CER-4} Auto-attached context claim for a handshake made at a known event. */
export interface EventContext {
  eventName: string;
  /** ISO date */
  date: string;
}

/** {CER-2, PLC-2/3} Atomic permission grants, per relationship direction. Extensible. */
export interface Grant {
  /** Connection scoped to a community context; wideable later by the granter. */
  contextLimit?: "ecstatic-dance";
  /** May see my offers at their level. */
  offersVisible: boolean;
  /** May see my second ring (people who consent). Interacts with the dial {YOU-2}. */
  secondRingVisible: boolean;
}
export const DEFAULT_GRANT: Grant = {
  contextLimit: "ecstatic-dance",
  offersVisible: true,
  secondRingVisible: true,
};

/** {CER-5} Relationship lifecycle. Mutual only after the counter-attestation. */
export type RelState = "none" | "pending_out" | "pending_in" | "mutual";

/**
 * A relationship edge as the client sees it. Levels are stated per direction;
 * gate checks use effectiveLevel() (min rule — ADR-2 recommendation, OPEN).
 * `theySeeMe=false` on a visible person is ALWAYS surfaced in UI ("sees you: no") {WEB-4}.
 */
export interface Edge {
  a: PersonId;
  b: PersonId;
  levelAtoB: Level;
  levelBtoA: Level;
  state: RelState;
  grantAtoB: Grant;
  grantBtoA: Grant;
  context?: EventContext;
}

export function effectiveLevel(e: Edge): Level {
  return LEVEL_ORDER[e.levelAtoB] <= LEVEL_ORDER[e.levelBtoA] ? e.levelAtoB : e.levelBtoA;
}

/** {CER-3} The handshake payload — identical across QR and NFC. Works offline.
 *  Replay bar: single-use nonce + short TTL now; rolling code is ADR-13 (OPEN). */
export interface HandshakePayload {
  did: string;
  displayName: string;
  /** base64url X25519 public key — lets acceptance queue offline. */
  encKey: string;
  nonce: string;
  /** unix ms */
  ts: number;
  ttlSeconds: number;
  offeredLevel: Level;
  grants: Grant;
}

/** {HST-1..5, DIS-2/3} A gathering. Location can be gated separately from existence. */
export interface EventRecord {
  id: string;
  name: string;
  /** human line: when · where · who */
  meta: string;
  tier: Tier;
  /** path-distance limit, 1..3, default 2 {HST-3} */
  steps: number;
  hostIds: PersonId[];
  kind: "ecstatic" | "biodanza" | "contact-improv" | "hangout" | "ceremony" | "other";
  /** linked-ecosystem marker (filter at the edge) */
  linked?: boolean;
  mine?: boolean;
  /** display name of the connection through whom this gated item reached the viewer */
  reachedVia?: string;
  /** exact location is a separately gated field — visible existence, location on arrival */
  locationGated?: boolean;
}

/** {RES-1..7} Offers + loans. */
export type LoanState = "available" | "requested" | "lent" | "returned" | "complete";

export interface Offer {
  id: string;
  item: string;
  description: string;
  /** absent when identityWithheld {RES-7} */
  ownerId?: PersonId;
  /** the mutual through whom an anonymous offer is reachable {RES-7} */
  viaId?: PersonId;
  identityWithheld?: boolean;
  tier: Exclude<Tier, "public">;
  /** path-distance limit like events {HST-3}; default 2 */
  steps?: number;
  state: LoanState;
  /** owner-approved re-offers, one ring further through these people {RES-6}; always revocable */
  extendedVia?: PersonId[];
  mine?: boolean;
}

/** {RES-5} Never numeric. Private to the parties; a false record is additionally
 *  readable only within the recording party's close-friend circle. */
export interface Completion {
  loanId: string;
  party: PersonId;
  feltComplete: boolean;
  note?: string;
  ts: number;
}

/** {ACT-1/2} Chat feed items awaiting the user. Badge counts only undone items. */
export type ActivityKind =
  | "borrow_request"
  | "extension_approval"
  | "loan_update"
  | "completion_checkin"
  | "connection_pending"
  | "level_change";

export interface ActivityAction {
  id: string;
  label: string;
  kind: "primary" | "ceremonial" | "quiet";
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  /** display name of the counterpart (or "Completion") */
  who: string;
  icon?: string;
  text: string;
  subtext?: string;
  actions: ActivityAction[];
  done: boolean;
  resolution?: string;
  /** docs/60 anchor this item demonstrates, for spec mode */
  anchor?: string;
}

/** {ACT-2, ADR-14} A DM thread. Ring-1 only; ring-2 requires an introduction. */
export interface ThreadMsg {
  who: "me" | "them";
  text: string;
}
export interface Thread {
  personId: PersonId;
  name: string;
  msgs: ThreadMsg[];
}

/** {INT-1/2, ADR-12} Introduction suggestion. Inputs: declared needs/offers/non-adjacency.
 *  Non-inputs: message content, behavior, engagement. */
export interface IntroSuggestion {
  id: string;
  seekerName: string;
  holderName: string;
  item: string;
  status: "open" | "done" | "dismissed";
}

/** A person as rendered in the web/people views. */
export interface PersonView {
  id: PersonId;
  name: string;
  /** 1 = direct, 2 = through a mutual */
  ring: 1 | 2;
  level?: Level;
  state: RelState;
  /** name of the mutual for ring-2 people */
  via?: string;
  /** {WEB-4} false ⇒ UI must label "sees you: no" */
  seesYou: boolean;
  /** {WEB-5} item they offer that is visible to me */
  offer?: string;
  /** {RES-7} anonymous offerer — no name, no card */
  anonymous?: boolean;
  metContext?: string;
}
