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

export interface StateSnapshot {
  persona: { name: string; peer_id: string; accent: string };
  items: Item[];
  trust_edges: TrustEdge[];
  asks: AskApiView[];
  consent_cards: ConsentCardApiView[];
  rooms: RoomApiView[];
  steward_log: StewardLogApiView[];
}

export interface AuditApiEntry {
  ts: string;
  decision: string;
  detail: string;
}
