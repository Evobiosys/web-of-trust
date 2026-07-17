/**
 * Local TS types mirroring docs/API.md (daemon <-> device-ui contract, v0.1,
 * frozen). Deliberately NOT imported from @resource-web/protocol: the
 * asker-side `asks[]` here is a sanitized REST view distinct from the wire
 * envelopes that package owns, and device-ui does not own that package.
 */

export type Accent = "warm" | "cool" | "neutral";

export interface Persona {
  name: string;
  peer_id: string;
  accent: Accent;
}

export type ProvenanceSelf = { kind: "self" };
export type ProvenanceSecondBrain = {
  kind: "second_brain";
  owner: string;
  noted_at: string;
};
export type Provenance = ProvenanceSelf | ProvenanceSecondBrain;

export interface SharePolicy {
  audience: "private" | "trusted" | "wot_commons";
  mode: "ask_each_time" | "auto_forward";
  requires?: ("profile_photo" | "note_from_requester")[];
  expires_at?: string;
}

export interface Item {
  id: string;
  labels: string[];
  description: string;
  tags: string[];
  provenance: Provenance;
  policy: SharePolicy;
  location_area?: string;
  availability?: string;
}

export interface TrustEdge {
  peer: string;
  display: string;
  vouched_by?: string;
  created_at: string;
  expires_at?: string;
}

/** Asker-side view of a request the device owner sent out. Sanitized per I2:
 * `queried_count` is an aggregate only — never which peers, never per-peer
 * state. There is nothing else in this shape to leak. */
export type AskState =
  | "open"
  | "waiting"
  | "someone_can_help"
  | "no_one_this_time"
  | "room_open"
  | "withdrawn";

export interface Ask {
  request_id: string;
  text: string;
  created_at: string;
  state: AskState;
  queried_count: number;
  room_id?: string;
}

export type ConsentCardState = "pending" | "consented" | "declined" | "inactive";

export interface ConsentCard {
  card_id: string;
  request_id: string;
  requester: { peer_id: string; display: string };
  text: string;
  matched_item: Item;
  kind: "direct" | "relay";
  state: ConsentCardState;
  created_at: string;
}

export interface RoomMessage {
  from: string;
  text: string;
  ts: string;
}

export interface Room {
  room_id: string;
  peers: { peer_id: string; display: string }[];
  messages: RoomMessage[];
  context: string;
}

export interface StewardLogEntry {
  role: "user" | "agent";
  text: string;
  ts: string;
}

export interface AgentState {
  persona: Persona;
  items: Item[];
  trust_edges: TrustEdge[];
  asks: Ask[];
  consent_cards: ConsentCard[];
  rooms: Room[];
  steward_log: StewardLogEntry[];
}

export interface StewardReply {
  reply: string;
}

export interface OkResponse {
  ok: true;
}

export interface ErrorResponse {
  error: string;
}

/** Server -> client WS events (docs/API.md § WS /ws). */
export type WsEvent =
  | { type: "state_changed" }
  | { type: "steward_reply"; text: string }
  | { type: "consent_card"; card_id: string }
  | { type: "ask_update"; request_id: string; state: AskState }
  | { type: "room_message"; room_id: string; from: string; text: string; ts: string };
