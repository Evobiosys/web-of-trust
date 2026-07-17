// SqliteStore — the Store implementation (I5). Tables per the M2-A brief:
// items, trust_edges, asks, incoming, rooms + room_messages, steward_log,
// audit_log, plus item_embeddings (matcher cache) and pending_capture
// (steward confirm-before-save). `DB_PATH` env selects the file; tests use
// ":memory:".
import { ItemSchema, TrustEdgeSchema, type Item, type TrustEdge } from "@resource-web/protocol";
import { createSqlDriver, type SqlDriver } from "./sql_driver.js";
import type { Store } from "./store.js";
import type {
  AskRecord,
  AuditRecord,
  IncomingRecord,
  PendingCaptureRecord,
  RoomMessageRecord,
  RoomRecord,
  StewardLogRecord,
} from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  labels_json TEXT NOT NULL,
  description TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  location_area TEXT,
  availability TEXT
);

CREATE TABLE IF NOT EXISTS item_embeddings (
  item_id TEXT NOT NULL,
  model TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  PRIMARY KEY (item_id, model)
);

CREATE TABLE IF NOT EXISTS trust_edges (
  peer TEXT PRIMARY KEY,
  display TEXT NOT NULL,
  vouched_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asks (
  request_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  lang TEXT,
  area TEXT,
  created_at TEXT NOT NULL,
  ttl_ms INTEGER NOT NULL,
  internal_state TEXT NOT NULL,
  queried_count INTEGER NOT NULL,
  peers_json TEXT NOT NULL,
  room_id TEXT,
  withdrawn_reason TEXT
);

CREATE TABLE IF NOT EXISTS incoming (
  card_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  requester_peer TEXT NOT NULL,
  requester_display TEXT NOT NULL,
  text TEXT NOT NULL,
  received_at TEXT NOT NULL,
  matched_item_id TEXT,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  internal_state TEXT NOT NULL,
  status_dispatch_at TEXT NOT NULL,
  status_dispatched INTEGER NOT NULL,
  conditions TEXT
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  peers_json TEXT NOT NULL,
  context TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_messages (
  room_id TEXT NOT NULL,
  from_peer TEXT NOT NULL,
  text TEXT NOT NULL,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS steward_log (
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_capture (
  proposal_id TEXT PRIMARY KEY,
  item_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  ts TEXT NOT NULL,
  request_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  redact_for_asker INTEGER NOT NULL,
  detail TEXT NOT NULL
);
`;

interface ItemRow {
  id: string;
  labels_json: string;
  description: string;
  tags_json: string;
  provenance_json: string;
  policy_json: string;
  location_area: string | null;
  availability: string | null;
}

function rowToItem(row: ItemRow): Item {
  return ItemSchema.parse({
    id: row.id,
    labels: JSON.parse(row.labels_json),
    description: row.description,
    tags: JSON.parse(row.tags_json),
    provenance: JSON.parse(row.provenance_json),
    policy: JSON.parse(row.policy_json),
    location_area: row.location_area ?? undefined,
    availability: row.availability ?? undefined,
  });
}

interface TrustEdgeRow {
  peer: string;
  display: string;
  vouched_by: string | null;
  created_at: string;
  expires_at: string;
}

function rowToTrustEdge(row: TrustEdgeRow): TrustEdge {
  return TrustEdgeSchema.parse({
    peer: row.peer,
    display: row.display,
    vouched_by: row.vouched_by ?? undefined,
    created_at: row.created_at,
    expires_at: row.expires_at,
  });
}

interface AskRow {
  request_id: string;
  text: string;
  lang: string | null;
  area: string | null;
  created_at: string;
  ttl_ms: number;
  internal_state: AskRecord["internal_state"];
  queried_count: number;
  peers_json: string;
  room_id: string | null;
  withdrawn_reason: AskRecord["withdrawn_reason"] | null;
}

function rowToAsk(row: AskRow): AskRecord {
  return {
    request_id: row.request_id,
    text: row.text,
    lang: row.lang ?? undefined,
    area: row.area ?? undefined,
    created_at: row.created_at,
    ttl_ms: row.ttl_ms,
    internal_state: row.internal_state,
    queried_count: row.queried_count,
    peers: JSON.parse(row.peers_json),
    room_id: row.room_id ?? undefined,
    withdrawn_reason: row.withdrawn_reason ?? undefined,
  };
}

interface IncomingRow {
  card_id: string;
  request_id: string;
  requester_peer: string;
  requester_display: string;
  text: string;
  received_at: string;
  matched_item_id: string | null;
  kind: IncomingRecord["kind"];
  state: IncomingRecord["state"];
  internal_state: IncomingRecord["internal_state"];
  status_dispatch_at: string;
  status_dispatched: number;
  conditions: string | null;
}

function rowToIncoming(row: IncomingRow): IncomingRecord {
  return {
    card_id: row.card_id,
    request_id: row.request_id,
    requester_peer: row.requester_peer,
    requester_display: row.requester_display,
    text: row.text,
    received_at: row.received_at,
    matched_item_id: row.matched_item_id ?? undefined,
    kind: row.kind,
    state: row.state,
    internal_state: row.internal_state,
    status_dispatch_at: row.status_dispatch_at,
    status_dispatched: Boolean(row.status_dispatched),
    conditions: row.conditions ?? undefined,
  };
}

interface RoomRow {
  room_id: string;
  request_id: string;
  peers_json: string;
  context: string;
  created_at: string;
}

function rowToRoom(row: RoomRow): RoomRecord {
  return {
    room_id: row.room_id,
    request_id: row.request_id,
    peers: JSON.parse(row.peers_json),
    context: row.context,
    created_at: row.created_at,
  };
}

export class SqliteStore implements Store {
  private readonly db: SqlDriver;

  constructor(path: string) {
    this.db = createSqlDriver(path);
    this.db.exec(SCHEMA);
  }

  putItem(item: Item): void {
    this.db.run(
      `INSERT INTO items (id, labels_json, description, tags_json, provenance_json, policy_json, location_area, availability)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET labels_json=excluded.labels_json, description=excluded.description,
         tags_json=excluded.tags_json, provenance_json=excluded.provenance_json, policy_json=excluded.policy_json,
         location_area=excluded.location_area, availability=excluded.availability`,
      [
        item.id,
        JSON.stringify(item.labels),
        item.description,
        JSON.stringify(item.tags),
        JSON.stringify(item.provenance),
        JSON.stringify(item.policy),
        item.location_area ?? null,
        item.availability ?? null,
      ]
    );
  }

  getItems(): Item[] {
    return this.db.all<ItemRow>("SELECT * FROM items").map(rowToItem);
  }

  getItem(id: string): Item | undefined {
    const row = this.db.get<ItemRow>("SELECT * FROM items WHERE id = ?", [id]);
    return row ? rowToItem(row) : undefined;
  }

  getItemEmbedding(itemId: string, model: string): number[] | undefined {
    const row = this.db.get<{ vector_json: string }>(
      "SELECT vector_json FROM item_embeddings WHERE item_id = ? AND model = ?",
      [itemId, model]
    );
    return row ? JSON.parse(row.vector_json) : undefined;
  }

  putItemEmbedding(itemId: string, model: string, vector: number[]): void {
    this.db.run(
      `INSERT INTO item_embeddings (item_id, model, vector_json) VALUES (?, ?, ?)
       ON CONFLICT(item_id, model) DO UPDATE SET vector_json=excluded.vector_json`,
      [itemId, model, JSON.stringify(vector)]
    );
  }

  putTrustEdge(edge: TrustEdge): void {
    this.db.run(
      `INSERT INTO trust_edges (peer, display, vouched_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(peer) DO UPDATE SET display=excluded.display, vouched_by=excluded.vouched_by,
         created_at=excluded.created_at, expires_at=excluded.expires_at`,
      [edge.peer, edge.display, edge.vouched_by ?? null, edge.created_at, edge.expires_at]
    );
  }

  getTrustEdges(): TrustEdge[] {
    return this.db.all<TrustEdgeRow>("SELECT * FROM trust_edges").map(rowToTrustEdge);
  }

  getTrustEdge(peer: string): TrustEdge | undefined {
    const row = this.db.get<TrustEdgeRow>("SELECT * FROM trust_edges WHERE peer = ?", [peer]);
    return row ? rowToTrustEdge(row) : undefined;
  }

  putAsk(ask: AskRecord): void {
    this.db.run(
      `INSERT INTO asks (request_id, text, lang, area, created_at, ttl_ms, internal_state, queried_count, peers_json, room_id, withdrawn_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(request_id) DO UPDATE SET text=excluded.text, lang=excluded.lang, area=excluded.area,
         created_at=excluded.created_at, ttl_ms=excluded.ttl_ms, internal_state=excluded.internal_state,
         queried_count=excluded.queried_count, peers_json=excluded.peers_json, room_id=excluded.room_id,
         withdrawn_reason=excluded.withdrawn_reason`,
      [
        ask.request_id,
        ask.text,
        ask.lang ?? null,
        ask.area ?? null,
        ask.created_at,
        ask.ttl_ms,
        ask.internal_state,
        ask.queried_count,
        JSON.stringify(ask.peers),
        ask.room_id ?? null,
        ask.withdrawn_reason ?? null,
      ]
    );
  }

  getAsk(requestId: string): AskRecord | undefined {
    const row = this.db.get<AskRow>("SELECT * FROM asks WHERE request_id = ?", [requestId]);
    return row ? rowToAsk(row) : undefined;
  }

  getAsks(): AskRecord[] {
    return this.db.all<AskRow>("SELECT * FROM asks ORDER BY created_at ASC").map(rowToAsk);
  }

  putIncoming(record: IncomingRecord): void {
    this.db.run(
      `INSERT INTO incoming (card_id, request_id, requester_peer, requester_display, text, received_at,
         matched_item_id, kind, state, internal_state, status_dispatch_at, status_dispatched, conditions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(card_id) DO UPDATE SET requester_peer=excluded.requester_peer,
         requester_display=excluded.requester_display, text=excluded.text, received_at=excluded.received_at,
         matched_item_id=excluded.matched_item_id, kind=excluded.kind, state=excluded.state,
         internal_state=excluded.internal_state, status_dispatch_at=excluded.status_dispatch_at,
         status_dispatched=excluded.status_dispatched, conditions=excluded.conditions`,
      [
        record.card_id,
        record.request_id,
        record.requester_peer,
        record.requester_display,
        record.text,
        record.received_at,
        record.matched_item_id ?? null,
        record.kind,
        record.state,
        record.internal_state,
        record.status_dispatch_at,
        record.status_dispatched ? 1 : 0,
        record.conditions ?? null,
      ]
    );
  }

  getIncoming(cardId: string): IncomingRecord | undefined {
    const row = this.db.get<IncomingRow>("SELECT * FROM incoming WHERE card_id = ?", [cardId]);
    return row ? rowToIncoming(row) : undefined;
  }

  getIncomingByRequestAndPeer(requestId: string, requesterPeer: string): IncomingRecord | undefined {
    const row = this.db.get<IncomingRow>(
      "SELECT * FROM incoming WHERE request_id = ? AND requester_peer = ?",
      [requestId, requesterPeer]
    );
    return row ? rowToIncoming(row) : undefined;
  }

  getIncomings(): IncomingRecord[] {
    return this.db.all<IncomingRow>("SELECT * FROM incoming ORDER BY received_at ASC").map(rowToIncoming);
  }

  putRoom(room: RoomRecord): void {
    this.db.run(
      `INSERT INTO rooms (room_id, request_id, peers_json, context, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET peers_json=excluded.peers_json, context=excluded.context`,
      [room.room_id, room.request_id, JSON.stringify(room.peers), room.context, room.created_at]
    );
  }

  getRoom(roomId: string): RoomRecord | undefined {
    const row = this.db.get<RoomRow>("SELECT * FROM rooms WHERE room_id = ?", [roomId]);
    return row ? rowToRoom(row) : undefined;
  }

  getRooms(): RoomRecord[] {
    return this.db.all<RoomRow>("SELECT * FROM rooms ORDER BY created_at ASC").map(rowToRoom);
  }

  addRoomMessage(msg: RoomMessageRecord): void {
    this.db.run("INSERT INTO room_messages (room_id, from_peer, text, ts) VALUES (?, ?, ?, ?)", [
      msg.room_id,
      msg.from,
      msg.text,
      msg.ts,
    ]);
  }

  getRoomMessages(roomId: string): RoomMessageRecord[] {
    return this.db
      .all<{ room_id: string; from_peer: string; text: string; ts: string }>(
        "SELECT * FROM room_messages WHERE room_id = ? ORDER BY ts ASC",
        [roomId]
      )
      .map((r) => ({ room_id: r.room_id, from: r.from_peer, text: r.text, ts: r.ts }));
  }

  addStewardLog(entry: StewardLogRecord): void {
    this.db.run("INSERT INTO steward_log (role, text, ts) VALUES (?, ?, ?)", [entry.role, entry.text, entry.ts]);
  }

  getStewardLog(): StewardLogRecord[] {
    return this.db.all<StewardLogRecord>("SELECT role, text, ts FROM steward_log ORDER BY ts ASC");
  }

  putPendingCapture(record: PendingCaptureRecord): void {
    this.db.run(
      `INSERT INTO pending_capture (proposal_id, item_json, created_at) VALUES (?, ?, ?)
       ON CONFLICT(proposal_id) DO UPDATE SET item_json=excluded.item_json`,
      [record.proposal_id, JSON.stringify(record.item), record.created_at]
    );
  }

  getLatestPendingCapture(): PendingCaptureRecord | undefined {
    const row = this.db.get<{ proposal_id: string; item_json: string; created_at: string }>(
      "SELECT * FROM pending_capture ORDER BY created_at DESC LIMIT 1"
    );
    return row ? { proposal_id: row.proposal_id, item: JSON.parse(row.item_json), created_at: row.created_at } : undefined;
  }

  clearPendingCapture(proposalId: string): void {
    this.db.run("DELETE FROM pending_capture WHERE proposal_id = ?", [proposalId]);
  }

  addAudit(entry: AuditRecord): void {
    this.db.run(
      "INSERT INTO audit_log (ts, request_id, actor, action, reason, redact_for_asker, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [entry.ts, entry.request_id, entry.actor, entry.action, entry.reason ?? null, entry.redact_for_asker ? 1 : 0, entry.detail]
    );
  }

  getAudit(): AuditRecord[] {
    return this.db
      .all<{
        ts: string;
        request_id: string;
        actor: AuditRecord["actor"];
        action: string;
        reason: string | null;
        redact_for_asker: number;
        detail: string;
      }>("SELECT * FROM audit_log ORDER BY ts ASC")
      .map((r) => ({
        ts: r.ts,
        request_id: r.request_id,
        actor: r.actor,
        action: r.action,
        reason: r.reason ?? undefined,
        redact_for_asker: Boolean(r.redact_for_asker),
        detail: r.detail,
      }));
  }

  close(): void {
    this.db.close();
  }
}
