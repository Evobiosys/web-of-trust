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

/** Audit log entry, extended with the redaction hint the store/API layer needs for I2. */
export interface AuditRecord extends DecisionLogEntry {
  /** When true, this entry's `detail`/`reason` must never surface a peer id or a
   * PENDING-vs-PASS distinction on the asker-facing /api/audit view (I2). Owner-side
   * entries (actor: "owner") are never redacted — I4 gives the owner full context. */
  redact_for_asker: boolean;
  detail: string;
}
