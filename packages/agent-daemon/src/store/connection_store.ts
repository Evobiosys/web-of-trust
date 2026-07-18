// ConnectionRecordStore — Task 8 (QR in-person introduction) persistence for
// the connection-bootstrap data a scanned meet-card carries (core-transport-
// plan.md Task 8): `{did, relays, ice_servers?}`. A later transport ladder
// (LadderChannel, Task 3') reads this to know how to reach a peer.
//
// Deliberately NOT folded into the central `Store` interface (store.ts):
// that seam is for lifecycle/matcher/steward/REST records every daemon
// subsystem shares, and this record is read by transport wiring, not by
// daemon.ts. Instead this mirrors packages/transport/src/relay_queue_store.ts
// — a small, self-contained store behind its own interface, using this
// package's own `SqlDriver` seam (sql_driver.ts) rather than duplicating the
// better-sqlite3/node:sqlite fallback (D6) a second time.
//
// D14 JSON-column pattern (see sqlite_store.ts's `*_json` columns): `relays`
// and `ice_servers` are arrays, so they serialize through `relays_json` /
// `ice_servers_json` TEXT columns exactly like `trust_edges`'s siblings do.
// Upsert-by-did mirrors sqlite_store.ts's `putTrustEdge` ON CONFLICT idiom.
import { createSqlDriver, type SqlDriver } from "./sql_driver.js";

/** One peer's reachable-connection bootstrap data, as scanned off their meet-card. */
export interface ConnectionRecord {
  /** The peer's did:peer:2 string — same value as their trust-edge `peer` in DIDComm mode. */
  did: string;
  /** Relay-node DIDs this peer is reachable through (CardPayload.relays). */
  relays: string[];
  /** Optional STUN/TURN URLs, reserved for the deferred WebRTC rung. */
  ice_servers?: string[];
  /** ISO timestamp of the last scan/upsert. */
  updated_at: string;
}

export interface ConnectionRecordStore {
  /** Upsert by `did` — a rescanned/updated card replaces the prior record. */
  putConnection(record: ConnectionRecord): void;
  getConnection(did: string): ConnectionRecord | undefined;
  getConnections(): ConnectionRecord[];
  close?(): void;
}

/** Deep-copies a record so callers can't mutate the store's internal state through a returned reference. */
function cloneRecord(record: ConnectionRecord): ConnectionRecord {
  return {
    did: record.did,
    relays: [...record.relays],
    ice_servers: record.ice_servers ? [...record.ice_servers] : undefined,
    updated_at: record.updated_at,
  };
}

/** In-memory default: exercised by tests and any transport/mock wiring that doesn't need restart-survival. */
export class InMemoryConnectionRecordStore implements ConnectionRecordStore {
  private readonly rows = new Map<string, ConnectionRecord>();

  putConnection(record: ConnectionRecord): void {
    this.rows.set(record.did, cloneRecord(record));
  }

  getConnection(did: string): ConnectionRecord | undefined {
    const row = this.rows.get(did);
    return row ? cloneRecord(row) : undefined;
  }

  getConnections(): ConnectionRecord[] {
    return [...this.rows.values()].map(cloneRecord);
  }
}

interface ConnectionRow {
  did: string;
  relays_json: string;
  ice_servers_json: string | null;
  updated_at: string;
}

function rowToRecord(row: ConnectionRow): ConnectionRecord {
  return {
    did: row.did,
    relays: JSON.parse(row.relays_json) as string[],
    ice_servers: row.ice_servers_json !== null ? (JSON.parse(row.ice_servers_json) as string[]) : undefined,
    updated_at: row.updated_at,
  };
}

/** SQLite-backed store: connection records survive an agent-daemon process restart. */
export class SqliteConnectionRecordStore implements ConnectionRecordStore {
  private readonly db: SqlDriver;

  constructor(dbPath: string) {
    this.db = createSqlDriver(dbPath);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS connection_records (" +
        "did TEXT PRIMARY KEY, " +
        "relays_json TEXT NOT NULL, " +
        "ice_servers_json TEXT, " +
        "updated_at TEXT NOT NULL" +
        ")"
    );
  }

  putConnection(record: ConnectionRecord): void {
    this.db.run(
      `INSERT INTO connection_records (did, relays_json, ice_servers_json, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(did) DO UPDATE SET relays_json=excluded.relays_json, ice_servers_json=excluded.ice_servers_json,
         updated_at=excluded.updated_at`,
      [record.did, JSON.stringify(record.relays), record.ice_servers !== undefined ? JSON.stringify(record.ice_servers) : null, record.updated_at]
    );
  }

  getConnection(did: string): ConnectionRecord | undefined {
    const row = this.db.get<ConnectionRow>("SELECT * FROM connection_records WHERE did = ?", [did]);
    return row ? rowToRecord(row) : undefined;
  }

  getConnections(): ConnectionRecord[] {
    return this.db.all<ConnectionRow>("SELECT * FROM connection_records ORDER BY did ASC").map(rowToRecord);
  }

  close(): void {
    this.db.close();
  }
}
