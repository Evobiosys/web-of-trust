// Store-layer record types. These are agent-daemon's own persistence shapes —
// distinct from (but built on top of) the protocol package's wire/domain
// types. Kept in one file so the Store interface (store.ts) and both
// implementations (sqlite_store.ts, node_sqlite_store.ts) share one contract.
import type { DecisionLogEntry, Item, TrustEdge } from "@resource-web/protocol";

/** Internal per-peer status for one outstanding ask — NEVER exposed as-is over the API (I2). */
export type AskPeerState = "queried" | "pass" | "pending" | "consented" | "declined";

export interface AskPeerRecord {
  peer: string;
  state: AskPeerState;
}

/** Asker-side lifecycle record for one request this persona sent. */
export interface AskRecord {
  request_id: string;
  text: string;
  lang?: string;
  area?: string;
  created_at: string;
  ttl_ms: number;
  /** internal asker state machine value (state-machine.ts AskerRequestState) */
  internal_state: "open" | "pass" | "pending" | "consented" | "room" | "closed" | "withdrawn";
  queried_count: number;
  peers: AskPeerRecord[];
  room_id?: string;
  withdrawn_reason?: "fulfilled" | "expired" | "cancelled";
}

export type IncomingKind = "direct" | "relay";
export type ConsentCardState = "pending" | "consented" | "declined" | "inactive";

/** Owner-side lifecycle record for one request received from a peer (consent card + bookkeeping). */
export interface IncomingRecord {
  card_id: string;
  request_id: string;
  requester_peer: string;
  requester_display: string;
  text: string;
  received_at: string;
  matched_item_id?: string;
  kind: IncomingKind;
  state: ConsentCardState;
  /** internal owner state machine value (state-machine.ts OwnerRequestState) */
  internal_state: "received" | "matched" | "no_match" | "consented" | "passed" | "closed" | "withdrawn";
  status_dispatch_at: string;
  status_dispatched: boolean;
  conditions?: string;
}

export interface RoomRecord {
  room_id: string;
  request_id: string;
  peers: Array<{ peer_id: string; display: string }>;
  context: string;
  created_at: string;
}

export interface RoomMessageRecord {
  room_id: string;
  from: string;
  text: string;
  ts: string;
}

export interface StewardLogRecord {
  role: "user" | "agent";
  text: string;
  ts: string;
}

/** A capture proposal awaiting the user's "yes/ja" confirmation (confirm-before-save). */
export interface PendingCaptureRecord {
  proposal_id: string;
  item: Omit<Item, "id">;
  created_at: string;
}

export type RelayLinkState = "awaiting_downstream" | "resolved" | "failed";

/**
 * I8 relay bookkeeping — links an upstream (asker-facing) consent card of
 * `kind: "relay"` to the fresh downstream REQUEST sent to the noted owner.
 * One row per relay hop; keyed by `downstream_request_id` since that's the
 * id every subsequent STATUS/CONSENT/INTRO from the noted owner arrives
 * tagged with (daemon.ts's `handleEnvelope` looks rows up that way to decide
 * whether an incoming envelope belongs to a relay in flight rather than a
 * normal direct ask). Never exposed over the REST API — internal only.
 */
export interface RelayLinkRecord {
  upstream_request_id: string;
  upstream_requester: string;
  downstream_request_id: string;
  noted_owner: string;
  state: RelayLinkState;
}

// ---------------------------------------------------------------- D18: consent-gated inbound CONNECT --

export type ConnectDirection = "inbound" | "outbound";
export type ConnectCardState = "pending" | "accepted" | "declined";

/**
 * D18 (Task 4): one side of a consent-gated CONNECT handshake between a
 * brand-new self-sovereign peer and an origin it scanned. Kept in its own
 * table (NOT the `incoming` consent-card table) because a connect card has no
 * matched item — the `IncomingRecord`/`ConsentCardApiView` path requires one
 * (sanitize.ts throws on a missing item) and its lifecycle/dispatch machinery
 * (I3 uniform-delay STATUS) does not apply here.
 *
 * `direction` splits the two roles:
 *  - "inbound"  — a CONNECT this persona RECEIVED (origin/owner side). Surfaces
 *    as an owner consent card (I4: full requester context). Accept forms an
 *    edge + sends CONNECT_ACK back; decline sends a gentle CONNECT_ACK{false}.
 *  - "outbound" — a CONNECT this persona SENT (new-peer side). Recorded so a
 *    later CONNECT_ACK can be correlated by `request_id` and its `from`
 *    verified against `peer` BEFORE forming the reciprocal edge — an
 *    unsolicited CONNECT_ACK must never create an edge.
 *
 * `peer` is the transport-authenticated counterparty DID (never body-claimed).
 * `requested_level` is the level the CONNECT body wished for (advisory only;
 * clamped, never auto-escalated — I9). `relay` is the CONNECT's optional
 * relay-routing hint, stored for a real transport (the in-memory harness
 * ignores it).
 */
export interface ConnectRecord {
  card_id: string;
  request_id: string;
  direction: ConnectDirection;
  peer: string;
  display: string;
  requested_level?: "contact" | "friend" | "close";
  relay?: string;
  state: ConnectCardState;
  created_at: string;
}

// ---------------------------------------------------------------- D14: listings, loans, DM threads --

export type ListingKind = "offer" | "gathering";
/** Same value space as protocol's SharePolicyAudienceSchema — a listing's tier reuses it (D14). */
export type ListingTier = "private" | "close" | "trusted" | "wot_commons" | "public";
export type ListingState = "active" | "withdrawn";

/** A listing THIS persona owns and published — `listings_mine`. */
export interface ListingRecord {
  listing_id: string;
  kind: ListingKind;
  title: string;
  description: string;
  when?: string;
  where_public?: string;
  where_gated?: string;
  tier: ListingTier;
  steps: 1 | 2 | 3;
  owner_display: string;
  state: ListingState;
  created_at: string;
}

/**
 * A listing this persona received from someone else — directly from its
 * owner (`via.length === 0`) or forwarded through one or more hops
 * (`via` lists each forwarder's peer id so far). `from_peer` is whoever
 * delivered THIS envelope to me (immediate sender, not necessarily the
 * owner). `forwarded` guards daemon/listings.ts's forward step against
 * re-running for a duplicate delivery of the same (listing_id, state) pair
 * — without it, a cyclic trust graph could re-forward indefinitely.
 */
export interface ReceivedListingRecord {
  listing_id: string;
  kind: ListingKind;
  title: string;
  description: string;
  when?: string;
  where_public?: string;
  where_gated?: string;
  tier: ListingTier;
  steps: number;
  via: string[];
  owner_display: string;
  state: ListingState;
  from_peer: string;
  received_at: string;
  forwarded: boolean;
}

export type LoanState = "requested" | "approved" | "declined" | "lent" | "returned" | "complete" | "not_yet";

/**
 * One loan, as seen from THIS persona's side (each party keeps their own
 * row for the same `loan_id`). `role` says which side this persona plays.
 * `completion_detail` is the "not_yet" explanation — I5/mockup RES-5: never
 * sent over the wire, local-only regardless of role (see
 * daemon/listings.ts's `checkInLoanCompletion`).
 */
export interface LoanRecord {
  loan_id: string;
  listing_id: string;
  role: "owner" | "borrower";
  counterparty_peer: string;
  counterparty_display: string;
  state: LoanState;
  note?: string;
  created_at: string;
  updated_at: string;
  completion_detail?: string;
}

export type DmDirection = "outgoing" | "incoming";

/** One DM chat line. `peer` is always the OTHER party — the thread key. */
export interface DmMessageRecord {
  peer: string;
  direction: DmDirection;
  text: string;
  ts: string;
}

/** Audit log entry, extended with the redaction hint the store/API layer needs for I2. */
export interface AuditRecord extends DecisionLogEntry {
  /** When true, this entry's `detail`/`reason` must never surface a peer id or a
   * PENDING-vs-PASS distinction on the asker-facing /api/audit view (I2). Owner-side
   * entries (actor: "owner") are never redacted — I4 gives the owner full context. */
  redact_for_asker: boolean;
  detail: string;
}
