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
  DmMessageRecord,
  IncomingRecord,
  ListingRecord,
  LoanRecord,
  PendingCaptureRecord,
  ReceivedListingRecord,
  RelayLinkRecord,
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
  level TEXT NOT NULL DEFAULT 'friend',
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

CREATE TABLE IF NOT EXISTS relay_links (
  downstream_request_id TEXT PRIMARY KEY,
  upstream_request_id TEXT NOT NULL,
  upstream_requester TEXT NOT NULL,
  noted_owner TEXT NOT NULL,
  state TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS listings (
  listing_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  when_text TEXT,
  where_public TEXT,
  where_gated TEXT,
  tier TEXT NOT NULL,
  steps INTEGER NOT NULL,
  owner_display TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS received_listings (
  listing_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  when_text TEXT,
  where_public TEXT,
  where_gated TEXT,
  tier TEXT NOT NULL,
  steps INTEGER NOT NULL,
  via_json TEXT NOT NULL,
  owner_display TEXT NOT NULL,
  state TEXT NOT NULL,
  from_peer TEXT NOT NULL,
  received_at TEXT NOT NULL,
  forwarded INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS loans (
  loan_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  role TEXT NOT NULL,
  counterparty_peer TEXT NOT NULL,
  counterparty_display TEXT NOT NULL,
  state TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completion_detail TEXT
);

CREATE TABLE IF NOT EXISTS dm_messages (
  peer TEXT NOT NULL,
  direction TEXT NOT NULL,
  text TEXT NOT NULL,
  ts TEXT NOT NULL
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
  level: TrustEdge["level"];
  created_at: string;
  expires_at: string;
}

function rowToTrustEdge(row: TrustEdgeRow): TrustEdge {
  return TrustEdgeSchema.parse({
    peer: row.peer,
    display: row.display,
    vouched_by: row.vouched_by ?? undefined,
    level: row.level,
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

interface RelayLinkRow {
  downstream_request_id: string;
  upstream_request_id: string;
  upstream_requester: string;
  noted_owner: string;
  state: RelayLinkRecord["state"];
}

function rowToRelayLink(row: RelayLinkRow): RelayLinkRecord {
  return {
    downstream_request_id: row.downstream_request_id,
    upstream_request_id: row.upstream_request_id,
    upstream_requester: row.upstream_requester,
    noted_owner: row.noted_owner,
    state: row.state,
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

interface ListingRow {
  listing_id: string;
  kind: ListingRecord["kind"];
  title: string;
  description: string;
  when_text: string | null;
  where_public: string | null;
  where_gated: string | null;
  tier: ListingRecord["tier"];
  steps: ListingRecord["steps"];
  owner_display: string;
  state: ListingRecord["state"];
  created_at: string;
}

function rowToListing(row: ListingRow): ListingRecord {
  return {
    listing_id: row.listing_id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    when: row.when_text ?? undefined,
    where_public: row.where_public ?? undefined,
    where_gated: row.where_gated ?? undefined,
    tier: row.tier,
    steps: row.steps,
    owner_display: row.owner_display,
    state: row.state,
    created_at: row.created_at,
  };
}

interface ReceivedListingRow {
  listing_id: string;
  kind: ReceivedListingRecord["kind"];
  title: string;
  description: string;
  when_text: string | null;
  where_public: string | null;
  where_gated: string | null;
  tier: ReceivedListingRecord["tier"];
  steps: number;
  via_json: string;
  owner_display: string;
  state: ReceivedListingRecord["state"];
  from_peer: string;
  received_at: string;
  forwarded: number;
}

function rowToReceivedListing(row: ReceivedListingRow): ReceivedListingRecord {
  return {
    listing_id: row.listing_id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    when: row.when_text ?? undefined,
    where_public: row.where_public ?? undefined,
    where_gated: row.where_gated ?? undefined,
    tier: row.tier,
    steps: row.steps,
    via: JSON.parse(row.via_json),
    owner_display: row.owner_display,
    state: row.state,
    from_peer: row.from_peer,
    received_at: row.received_at,
    forwarded: Boolean(row.forwarded),
  };
}

interface LoanRow {
  loan_id: string;
  listing_id: string;
  role: LoanRecord["role"];
  counterparty_peer: string;
  counterparty_display: string;
  state: LoanRecord["state"];
  note: string | null;
  created_at: string;
  updated_at: string;
  completion_detail: string | null;
}

function rowToLoan(row: LoanRow): LoanRecord {
  return {
    loan_id: row.loan_id,
    listing_id: row.listing_id,
    role: row.role,
    counterparty_peer: row.counterparty_peer,
    counterparty_display: row.counterparty_display,
    state: row.state,
    note: row.note ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completion_detail: row.completion_detail ?? undefined,
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
      `INSERT INTO trust_edges (peer, display, vouched_by, level, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(peer) DO UPDATE SET display=excluded.display, vouched_by=excluded.vouched_by, level=excluded.level,
         created_at=excluded.created_at, expires_at=excluded.expires_at`,
      [edge.peer, edge.display, edge.vouched_by ?? null, edge.level, edge.created_at, edge.expires_at]
    );
  }

  getTrustEdges(): TrustEdge[] {
    return this.db.all<TrustEdgeRow>("SELECT * FROM trust_edges").map(rowToTrustEdge);
  }

  getTrustEdge(peer: string): TrustEdge | undefined {
    const row = this.db.get<TrustEdgeRow>("SELECT * FROM trust_edges WHERE peer = ?", [peer]);
    return row ? rowToTrustEdge(row) : undefined;
  }

  removeTrustEdge(peer: string): void {
    this.db.run("DELETE FROM trust_edges WHERE peer = ?", [peer]);
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

  putRelayLink(link: RelayLinkRecord): void {
    this.db.run(
      `INSERT INTO relay_links (downstream_request_id, upstream_request_id, upstream_requester, noted_owner, state)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(downstream_request_id) DO UPDATE SET upstream_request_id=excluded.upstream_request_id,
         upstream_requester=excluded.upstream_requester, noted_owner=excluded.noted_owner, state=excluded.state`,
      [link.downstream_request_id, link.upstream_request_id, link.upstream_requester, link.noted_owner, link.state]
    );
  }

  getRelayLinkByDownstream(downstreamRequestId: string): RelayLinkRecord | undefined {
    const row = this.db.get<RelayLinkRow>("SELECT * FROM relay_links WHERE downstream_request_id = ?", [downstreamRequestId]);
    return row ? rowToRelayLink(row) : undefined;
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

  // -------------------------------------------------------- D14: listings --

  putListing(record: ListingRecord): void {
    this.db.run(
      `INSERT INTO listings (listing_id, kind, title, description, when_text, where_public, where_gated, tier, steps, owner_display, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(listing_id) DO UPDATE SET kind=excluded.kind, title=excluded.title, description=excluded.description,
         when_text=excluded.when_text, where_public=excluded.where_public, where_gated=excluded.where_gated,
         tier=excluded.tier, steps=excluded.steps, owner_display=excluded.owner_display, state=excluded.state`,
      [
        record.listing_id,
        record.kind,
        record.title,
        record.description,
        record.when ?? null,
        record.where_public ?? null,
        record.where_gated ?? null,
        record.tier,
        record.steps,
        record.owner_display,
        record.state,
        record.created_at,
      ]
    );
  }

  getListing(listingId: string): ListingRecord | undefined {
    const row = this.db.get<ListingRow>("SELECT * FROM listings WHERE listing_id = ?", [listingId]);
    return row ? rowToListing(row) : undefined;
  }

  getListings(): ListingRecord[] {
    return this.db.all<ListingRow>("SELECT * FROM listings ORDER BY created_at ASC").map(rowToListing);
  }

  putReceivedListing(record: ReceivedListingRecord): void {
    this.db.run(
      `INSERT INTO received_listings (listing_id, kind, title, description, when_text, where_public, where_gated, tier, steps, via_json, owner_display, state, from_peer, received_at, forwarded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(listing_id) DO UPDATE SET kind=excluded.kind, title=excluded.title, description=excluded.description,
         when_text=excluded.when_text, where_public=excluded.where_public, where_gated=excluded.where_gated,
         tier=excluded.tier, steps=excluded.steps, via_json=excluded.via_json, owner_display=excluded.owner_display,
         state=excluded.state, from_peer=excluded.from_peer, received_at=excluded.received_at, forwarded=excluded.forwarded`,
      [
        record.listing_id,
        record.kind,
        record.title,
        record.description,
        record.when ?? null,
        record.where_public ?? null,
        record.where_gated ?? null,
        record.tier,
        record.steps,
        JSON.stringify(record.via),
        record.owner_display,
        record.state,
        record.from_peer,
        record.received_at,
        record.forwarded ? 1 : 0,
      ]
    );
  }

  getReceivedListing(listingId: string): ReceivedListingRecord | undefined {
    const row = this.db.get<ReceivedListingRow>("SELECT * FROM received_listings WHERE listing_id = ?", [listingId]);
    return row ? rowToReceivedListing(row) : undefined;
  }

  getReceivedListings(): ReceivedListingRecord[] {
    return this.db.all<ReceivedListingRow>("SELECT * FROM received_listings ORDER BY received_at ASC").map(rowToReceivedListing);
  }

  // ------------------------------------------------------------ D14: loans --

  putLoan(record: LoanRecord): void {
    this.db.run(
      `INSERT INTO loans (loan_id, listing_id, role, counterparty_peer, counterparty_display, state, note, created_at, updated_at, completion_detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(loan_id) DO UPDATE SET listing_id=excluded.listing_id, role=excluded.role,
         counterparty_peer=excluded.counterparty_peer, counterparty_display=excluded.counterparty_display,
         state=excluded.state, note=excluded.note, updated_at=excluded.updated_at, completion_detail=excluded.completion_detail`,
      [
        record.loan_id,
        record.listing_id,
        record.role,
        record.counterparty_peer,
        record.counterparty_display,
        record.state,
        record.note ?? null,
        record.created_at,
        record.updated_at,
        record.completion_detail ?? null,
      ]
    );
  }

  getLoan(loanId: string): LoanRecord | undefined {
    const row = this.db.get<LoanRow>("SELECT * FROM loans WHERE loan_id = ?", [loanId]);
    return row ? rowToLoan(row) : undefined;
  }

  getLoans(): LoanRecord[] {
    return this.db.all<LoanRow>("SELECT * FROM loans ORDER BY created_at ASC").map(rowToLoan);
  }

  // -------------------------------------------------------- D14: DM threads --

  addDmMessage(msg: DmMessageRecord): void {
    this.db.run("INSERT INTO dm_messages (peer, direction, text, ts) VALUES (?, ?, ?, ?)", [msg.peer, msg.direction, msg.text, msg.ts]);
  }

  getDmMessages(peer: string): DmMessageRecord[] {
    return this.db.all<DmMessageRecord>("SELECT peer, direction, text, ts FROM dm_messages WHERE peer = ? ORDER BY ts ASC", [peer]);
  }

  getDmPeers(): string[] {
    return this.db.all<{ peer: string }>("SELECT DISTINCT peer FROM dm_messages ORDER BY peer ASC").map((r) => r.peer);
  }

  close(): void {
    this.db.close();
  }
}
