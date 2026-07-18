// Unit tests for ConnectionRecordStore (core-transport-plan.md Task 8).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryConnectionRecordStore, SqliteConnectionRecordStore, type ConnectionRecordStore, type ConnectionRecord } from "./connection_store.js";

const tempDirs: string[] = [];
function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "connection-store-test-"));
  tempDirs.push(dir);
  return join(dir, "connections.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const SAMPLE: ConnectionRecord = {
  did: "did:peer:2.Vzabc.Ezdef.Sghi",
  relays: ["did:peer:2.Vzrelay1", "did:peer:2.Vzrelay2"],
  ice_servers: ["stun:relay.example.org:3478"],
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe.each([
  ["InMemoryConnectionRecordStore", () => new InMemoryConnectionRecordStore() as ConnectionRecordStore],
  ["SqliteConnectionRecordStore", () => new SqliteConnectionRecordStore(makeTempDbPath()) as ConnectionRecordStore],
])("%s", (_name, makeStore) => {
  it("getConnection() is undefined for a did never put", () => {
    const store = makeStore();
    expect(store.getConnection("did:peer:2.never")).toBeUndefined();
  });

  it("putConnection() then getConnection() round-trips relays and ice_servers (D14 JSON-column pattern)", () => {
    const store = makeStore();
    store.putConnection(SAMPLE);
    expect(store.getConnection(SAMPLE.did)).toEqual(SAMPLE);
  });

  it("putConnection() omits ice_servers cleanly when not supplied", () => {
    const store = makeStore();
    const noIce: ConnectionRecord = { did: "did:peer:2.noice", relays: ["did:peer:2.Vzrelay1"], updated_at: "2026-01-02T00:00:00.000Z" };
    store.putConnection(noIce);
    const back = store.getConnection(noIce.did);
    expect(back?.ice_servers).toBeUndefined();
    expect(back?.relays).toEqual(["did:peer:2.Vzrelay1"]);
  });

  it("putConnection() upserts by did — a rescanned card replaces the prior relays list", () => {
    const store = makeStore();
    store.putConnection(SAMPLE);
    const updated: ConnectionRecord = { ...SAMPLE, relays: ["did:peer:2.Vznewrelay"], updated_at: "2026-02-01T00:00:00.000Z" };
    store.putConnection(updated);
    expect(store.getConnection(SAMPLE.did)).toEqual(updated);
    expect(store.getConnections()).toHaveLength(1);
  });

  it("getConnections() lists every stored record", () => {
    const store = makeStore();
    store.putConnection(SAMPLE);
    store.putConnection({ did: "did:peer:2.other", relays: [], updated_at: "2026-01-01T00:00:00.000Z" });
    expect(store.getConnections().map((r) => r.did).sort()).toEqual([SAMPLE.did, "did:peer:2.other"].sort());
  });

  it("returned records are copies — mutating one does not corrupt the store", () => {
    const store = makeStore();
    store.putConnection(SAMPLE);
    const got = store.getConnection(SAMPLE.did);
    got?.relays.push("did:peer:2.injected");
    expect(store.getConnection(SAMPLE.did)?.relays).toEqual(SAMPLE.relays);
  });
});

it("SqliteConnectionRecordStore: a put record is still there for a fresh instance opened on the same path (restart survival)", () => {
  const dbPath = makeTempDbPath();
  const first = new SqliteConnectionRecordStore(dbPath);
  first.putConnection(SAMPLE);
  first.close();

  const second = new SqliteConnectionRecordStore(dbPath);
  expect(second.getConnection(SAMPLE.did)).toEqual(SAMPLE);
  second.close();
});
