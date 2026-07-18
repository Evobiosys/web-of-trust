// DedupStore — replay-protection memory for DidCommTransport.receiveInbound
// (core-transport-plan.md §1 "Load-bearing finding" + Task 2).
//
// Store-and-forward delivers messages that are legitimately minutes-to-hours
// old (the recipient was offline when they were sent), so the old 5-minute
// REPLAY_WINDOW_MS freshness bound can no longer be the dedup horizon too —
// but freshness and dedup MUST stay coupled to the same horizon `H`, or
// widening freshness alone reopens a replay hole: an attacker could replay
// any message up to `H` old that has aged out of a *shorter* dedup window.
// MAX_HOLD_HORIZON_MS is that single shared horizon, consumed by both
// receiveInbound's freshness check and every DedupStore's retention.
//
// InMemoryDedupStore preserves today's behavior (default; existing tests and
// callers unaffected, dedup lost on restart). SqliteDedupStore persists
// across a process restart, which is what makes store-and-forward safe: a
// relay-delivered message replayed after the daemon restarts must still be
// caught. Per DECISIONS.md D6 / core-transport-plan.md Task 2, this package
// uses only the built-in `node:sqlite` (Node 22+, stable on our Node 26) —
// no native dependency (better-sqlite3 etc.) is added to @resource-web/transport.
//
// This package is ESM ("type": "module" / NodeNext); a static
// `import ... from "node:sqlite"` trips up this repo's Vite/vitest version
// (it doesn't externalize "node:sqlite" as a Node builtin yet, so the test
// runner tries — and fails — to resolve it as a bare module specifier).
// `createRequire` gives a synchronous CJS `require` for the same built-in
// module and sidesteps Vite's static import analysis entirely, mirroring the
// pattern already used for node:sqlite in
// packages/agent-daemon/src/store/sql_driver.ts.
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const requireCjs = createRequire(import.meta.url);
const { DatabaseSync } = requireCjs("node:sqlite") as typeof import("node:sqlite");

/** Freshness + dedup-retention horizon `H` — see the file header for why these are one constant. */
export const MAX_HOLD_HORIZON_MS = 72 * 60 * 60_000; // 72h

export interface DedupStore {
  /** Has this message id already been recorded (and not yet pruned)? */
  seen(id: string): boolean;
  /** Record a message id as seen, keyed with its (authenticated) created_time. */
  record(id: string, createdTime: number): void;
  /** Drop entries whose created_time is older than `now - H`. */
  prune(now: number): void;
}

/**
 * Default dedup store: an in-memory Map, exactly reproducing the retention
 * behavior of the `seen` map that used to live inline in DidCommTransport.
 * Lost on process restart — fine for a single long-lived process, but not
 * sufficient on its own for store-and-forward across a daemon restart (use
 * SqliteDedupStore for that).
 */
export class InMemoryDedupStore implements DedupStore {
  private readonly entries = new Map<string, number>(); // id -> created_time

  seen(id: string): boolean {
    return this.entries.has(id);
  }

  record(id: string, createdTime: number): void {
    this.entries.set(id, createdTime);
  }

  // Retention is always exactly MAX_HOLD_HORIZON_MS — not a constructor
  // param — so a store can never be built with a horizon shorter than the
  // transport's freshness check without also changing the shared constant.
  // A configurable-per-instance horizon would let freshness (H) and dedup
  // retention drift apart, silently reopening the replay hole this file's
  // header describes.
  prune(now: number): void {
    const cutoff = now - MAX_HOLD_HORIZON_MS;
    for (const [id, createdTime] of this.entries) {
      if (createdTime < cutoff) this.entries.delete(id);
    }
  }
}

/**
 * SQLite-backed dedup store: same contract as InMemoryDedupStore, but the
 * `seen_messages` table survives a process restart, so a message replayed
 * after a daemon restart is still rejected (proven in dedup_store.test.ts).
 * Synchronous by construction (node:sqlite's API is sync), which matches
 * receiveInbound's synchronous replay-check call sites — no new async seam.
 */
export class SqliteDedupStore implements DedupStore {
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS seen_messages (id TEXT PRIMARY KEY, created_time INTEGER NOT NULL)"
    );
  }

  seen(id: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM seen_messages WHERE id = ?").get(id);
    return row !== undefined;
  }

  record(id: string, createdTime: number): void {
    this.db
      .prepare("INSERT OR REPLACE INTO seen_messages (id, created_time) VALUES (?, ?)")
      .run(id, createdTime);
  }

  // Retention is always exactly MAX_HOLD_HORIZON_MS — see InMemoryDedupStore's
  // prune() comment for why this is not a per-instance constructor param.
  prune(now: number): void {
    const cutoff = now - MAX_HOLD_HORIZON_MS;
    this.db.prepare("DELETE FROM seen_messages WHERE created_time < ?").run(cutoff);
  }

  /** Not part of DedupStore (optional) — closes the underlying connection; tests use this between restarts. */
  close(): void {
    this.db.close();
  }
}
