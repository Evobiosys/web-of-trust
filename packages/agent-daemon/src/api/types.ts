// REST/WS wire shapes — must match docs/API.md exactly (frozen contract).
import type { Item, TrustEdge } from "@resource-web/protocol";

export type AskApiState = "open" | "waiting" | "someone_can_help" | "no_one_this_time" | "room_open" | "withdrawn";

export interface AskApiView {
  request_id: string;
  text: string;
  created_at: string;
  state: AskApiState;
  queried_count: number;
  room_id?: string;
}

export interface ConsentCardApiView {
  card_id: string;
  request_id: string;
  requester: { peer_id: string; display: string };
  text: string;
  matched_item: Item;
  kind: "direct" | "relay";
  state: "pending" | "consented" | "declined" | "inactive";
  created_at: string;
}

export interface RoomApiView {
  room_id: string;
  peers: Array<{ peer_id: string; display: string }>;
  messages: Array<{ from: string; text: string; ts: string }>;
  context: string;
}

export interface StewardLogApiView {
  role: "user" | "agent";
  text: string;
  ts: string;
}

// D14 — listings, loans, DM threads.
export type ListingApiTier = "private" | "close" | "trusted" | "wot_commons" | "public";

export interface ListingApiView {
  listing_id: string;
  kind: "offer" | "gathering";
  title: string;
  description: string;
  when?: string;
  where_public?: string;
  where_gated?: string;
  tier: ListingApiTier;
  steps: number;
  state: "active" | "withdrawn";
  owner_display: string;
  created_at: string;
}

export interface ReceivedListingApiView extends ListingApiView {
  via: string[];
  from_peer: string;
  received_at: string;
}

export interface LoanApiView {
  loan_id: string;
  listing_id: string;
  role: "owner" | "borrower";
  counterparty: { peer_id: string; display: string };
  state: "requested" | "approved" | "declined" | "lent" | "returned" | "complete" | "not_yet";
  note?: string;
  /** "not_yet" explanation — local only, own persona's own annotation (mockup RES-5). */
  completion_detail?: string;
  created_at: string;
  updated_at: string;
}

export interface DmMessageApiView {
  direction: "outgoing" | "incoming";
  text: string;
  ts: string;
}

export interface ThreadApiView {
  peer_id: string;
  display: string;
  messages: DmMessageApiView[];
}

export interface StateSnapshot {
  persona: { name: string; peer_id: string; accent: string };
  items: Item[];
  trust_edges: TrustEdge[];
  asks: AskApiView[];
  consent_cards: ConsentCardApiView[];
  rooms: RoomApiView[];
  steward_log: StewardLogApiView[];
  listings_mine: ListingApiView[];
  listings_received: ReceivedListingApiView[];
  loans: LoanApiView[];
  threads: ThreadApiView[];
}

export interface AuditApiEntry {
  ts: string;
  decision: string;
  detail: string;
}
