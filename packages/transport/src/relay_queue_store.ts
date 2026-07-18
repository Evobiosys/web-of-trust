// RelayQueueStore — store-and-forward persistence for relay_server.ts
// (core-transport-plan.md Task 6a).
//
// A relay holds an opaque wire (the outer ciphertext envelope produced by
// didcomm_crypto.ts's packMessage) for a recipient DID until that DID
// authenticates and drains it, or until it ages past the shared max-hold
// horizon `H` (MAX_HOLD_HORIZON_MS, imported from dedup_store.ts — same
// constant that bounds DidCommTransport's freshness check, per
// core-transport-plan.md §1's "Load-bearing finding": a relay must never
// hold a message longer than the receiving transport will still accept it).
//
// DEVIATION from the plan doc's literal interface sketch
// (`enqueue(): void; drain(): string[]`): drain() returns {id, wire} pairs,
// not bare wire strings, and enqueue() returns the assigned id. The outer
// wire has no cleartext message id (the JWM `id` lives inside the
// ciphertext — this store never decrypts, so it cannot read it), so
// ackDelivered(toDid, ids) needs *some* id to key on. The queue-row id
// (SQLite rowid, stringified) fills that role. Without this, drain+ack
// could not be implemented at all.
//
// Non-destructive drain: drain(toDid) is a repeatable READ of everything
// currently queued for toDid — it never removes rows. Only ackDelivered()
// removes rows (by id). This makes relay_server.ts's "re-enqueue unacked
// wires on disconnect" (Task 6c) trivial and crash-safe: a wire dequeued to
// a socket that then dies before acking was never actually removed from the
// store, so the very next drain() (on reconnect) returns it again — at
// most-once removal only ever happens after the recipient has confirmed
// receipt.
//
// Mirrors dedup_store.ts's node:sqlite access pattern exactly (same
// createRequire indirection, same "no native dependency in this package"
// constraint per DECISIONS.md D6).
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { MAX_HOLD_HORIZON_MS } from "./dedup_store.js";

const requireCjs = createRequire(import.meta.url);
const { DatabaseSync } = requireCjs("node:sqlite") as typeof import("node:sqlite");

export { MAX_HOLD_HORIZON_MS };

/** One persisted, not-yet-acked wire for a recipient DID. */
export interface QueuedWire {
  /** Queue-row id, assigned at enqueue(); the handle ackDelivered() removes by. */
  id: string;
  /** The opaque wire exactly as submitted — never mutated, never decrypted. */
  wire: string;
}

export interface RelayQueueStore {
  /** Persist `wire` for `toDid`. Returns the assigned queue-row id. */
  enqueue(toDid: string, wire: string): string;
  /** Non-destructive read of every currently-queued (unacked) wire for `toDid`, oldest first. */
  drain(toDid: string): QueuedWire[];
  /** Remove the given ids from `toDid`'s queue — the only operation that actually dequeues. */
  ackDelivered(toDid: string, ids: string[]): void;
  /** Drop rows older than `now - MAX_HOLD_HORIZON_MS` (caller-driven, mirrors DedupStore.prune). */
  prune(now: number): void;
}

/**
 * In-memory default: exercised by relay_server tests that don't need
 * restart-survival; lost on process restart (same trade-off as
 * InMemoryDedupStore).
 */
export class InMemoryRelayQueueStore implements RelayQueueStore {
  private nextId = 1;
  private readonly rows = new Map<string, { toDid: string; wire: string; enqueuedAt: number }>();

  enqueue(toDid: string, wire: string): string {
    const id = String(this.nextId++);
    this.rows.set(id, { toDid, wire, enqueuedAt: Date.now() });
    return id;
  }

  drain(toDid: string): QueuedWire[] {
    const out: QueuedWire[] = [];
    for (const [id, row] of this.rows) {
      if (row.toDid === toDid) out.push({ id, wire: row.wire });
    }
    return out;
  }

  ackDelivered(toDid: string, ids: string[]): void {
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row && row.toDid === toDid) this.rows.delete(id);
    }
  }

  prune(now: number): void {
    const cutoff = now - MAX_HOLD_HORIZON_MS;
    for (const [id, row] of this.rows) {
      if (row.enqueuedAt < cutoff) this.rows.delete(id);
    }
  }
}

/**
 * SQLite-backed store: the queue survives a relay process restart, which is
 * what makes store-and-forward for an offline recipient robust across the
 * relay itself being restarted while a message is in flight.
 */
export class SqliteRelayQueueStore implements RelayQueueStore {
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS relay_queue (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
        "to_did TEXT NOT NULL, " +
        "wire TEXT NOT NULL, " +
        "enqueued_at INTEGER NOT NULL" +
        ")"
    );
    this.db.exec("CREATE INDEX IF NOT EXISTS relay_queue_to_did ON relay_queue (to_did)");
  }

  enqueue(toDid: string, wire: string): string {
    const result = this.db
      .prepare("INSERT INTO relay_queue (to_did, wire, enqueued_at) VALUES (?, ?, ?)")
      .run(toDid, wire, Date.now());
    return String(result.lastInsertRowid);
  }

  drain(toDid: string): QueuedWire[] {
    const rows = this.db
      .prepare("SELECT id, wire FROM relay_queue WHERE to_did = ? ORDER BY id ASC")
      .all(toDid) as { id: number | bigint; wire: string }[];
    return rows.map((r) => ({ id: String(r.id), wire: r.wire }));
  }

  ackDelivered(toDid: string, ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    this.db
      .prepare(`DELETE FROM relay_queue WHERE to_did = ? AND id IN (${placeholders})`)
      .run(toDid, ...ids);
  }

  prune(now: number): void {
    const cutoff = now - MAX_HOLD_HORIZON_MS;
    this.db.prepare("DELETE FROM relay_queue WHERE enqueued_at < ?").run(cutoff);
  }

  /** Not part of RelayQueueStore (optional) — closes the underlying connection; tests use this between restarts. */
  close(): void {
    this.db.close();
  }
}
