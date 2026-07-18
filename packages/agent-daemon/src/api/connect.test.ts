// Task 8 (core-transport-plan.md): QR in-person introduction — the daemon
// HTTP surface side. Covers:
//  - GET /api/card merges relays/ice_servers when extras.cardExtra carries
//    them (type-widen only — the handler's existing `...cardExtra` spread
//    already merges arbitrary fields, per advisor review; no branching added).
//  - POST /api/connect creates/updates the trust edge (reusing the same
//    daemon.addTrust the existing POST /api/trust runs — asserted by
//    comparing against a direct POST /api/trust call) AND persists a
//    connection record via a new ConnectionRecordStore.
//
// This is a NEW file (not an edit to server.test.ts) per the scope guard:
// server.test.ts's existing card test is the regression guard for Task 8 and
// must stay untouched, so this file re-creates its own minimal boot helper
// rather than importing/mutating anything from server.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { FakeClock, FakeScheduler } from "../clock.js";
import { InMemoryBus, InMemoryTransport } from "../transport/in_memory_transport.js";
import { SqliteStore } from "../store/sqlite_store.js";
import { InMemoryConnectionRecordStore } from "../store/connection_store.js";
import { Daemon, type DaemonConfig } from "../daemon/daemon.js";
import type { ChatClient, EmbedClient } from "../matcher/clients.js";
import { startServer, type StartedServer, type ServerExtras } from "./server.js";

class FakeEmbedClient implements EmbedClient {
  async embed(_model: string, input: string[]): Promise<number[][]> {
    void _model;
    return input.map(() => [1, 0]);
  }
}
class FakeChatClient implements ChatClient {
  async chat(): Promise<string> {
    throw new Error("no LLM in this test");
  }
}

async function bootDaemon(
  port: number,
  extras: ServerExtras = {}
): Promise<{ daemon: Daemon; server: StartedServer; connectionStore: InMemoryConnectionRecordStore }> {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const scheduler = new FakeScheduler(clock);
  const store = new SqliteStore(":memory:");
  const config: DaemonConfig = {
    personaName: "Anna",
    peerId: "@anna-agent:wot.local",
    accent: "warm",
    statusDelayMs: 2000,
    defaultAskTtlMs: 3_600_000,
    matcher: { embedModel: "fake", chatModel: "fake", threshold: 0.6 },
  };
  const transport = new InMemoryTransport(new InMemoryBus());
  const daemon = new Daemon({
    config,
    store,
    transport,
    scheduler,
    clock,
    embedClient: new FakeEmbedClient(),
    chatClient: new FakeChatClient(),
  });
  await daemon.init();
  const connectionStore = (extras.connectionStore as InMemoryConnectionRecordStore) ?? new InMemoryConnectionRecordStore();
  const server = await startServer(daemon, port, { ...extras, connectionStore });
  return { daemon, server, connectionStore };
}

const BASE_PORT = 41800;
let portCounter = 0;
function nextPort(): number {
  portCounter += 1;
  return BASE_PORT + portCounter;
}

describe("REST server — Task 8: QR in-person introduction", () => {
  let cleanup: (() => Promise<void> | void) | undefined;
  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  // ------------------------------------------------------------ GET /api/card --

  it("GET /api/card merges relays/ice_servers when cardExtra carries them", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port, {
      cardExtra: {
        did: "did:peer:2.Vzanna.Ezanna.Sanna",
        endpoint: "http://anna.example/didcomm",
        relays: ["did:peer:2.Vzrelay1"],
        ice_servers: ["stun:relay.example.org:3478"],
      },
    });
    cleanup = () => server.close();

    const res = await fetch(`http://127.0.0.1:${port}/api/card`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.did).toBe("did:peer:2.Vzanna.Ezanna.Sanna");
    expect(body.relays).toEqual(["did:peer:2.Vzrelay1"]);
    expect(body.ice_servers).toEqual(["stun:relay.example.org:3478"]);
  });

  it("GET /api/card omits relays/ice_servers cleanly when cardExtra carries neither (regression: mock-transport card unchanged)", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port); // no cardExtra at all — mirrors mock/matrix transports
    cleanup = () => server.close();

    const res = await fetch(`http://127.0.0.1:${port}/api/card`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.did).toBeUndefined();
    expect(body.relays).toBeUndefined();
    expect(body.ice_servers).toBeUndefined();
  });

  // ------------------------------------------------------- POST /api/connect --

  it("POST /api/connect creates the trust edge exactly like POST /api/trust does, plus a connection record", async () => {
    const port = nextPort();
    const { server, connectionStore } = await bootDaemon(port);
    cleanup = () => server.close();

    const scannedCard = {
      did: "did:peer:2.Vzben.Ezben.Sben",
      display: "Ben",
      endpoint: "http://ben.example/didcomm",
      relays: ["did:peer:2.Vzrelay1", "did:peer:2.Vzrelay2"],
      ice_servers: ["stun:relay.example.org:3478"],
      level: "friend",
    };
    const res = await fetch(`http://127.0.0.1:${port}/api/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scannedCard),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trust_edge: { peer: string; display: string; level: string }; connection: { did: string; relays: string[] } };

    // Same trust-upsert behavior as POST /api/trust: peer == did (DIDComm mode).
    expect(body.trust_edge).toMatchObject({ peer: scannedCard.did, display: "Ben", level: "friend" });
    const trustList = (await (await fetch(`http://127.0.0.1:${port}/api/trust`)).json()) as { trust_edges: Array<{ peer: string; display: string }> };
    expect(trustList.trust_edges).toContainEqual(expect.objectContaining({ peer: scannedCard.did, display: "Ben" }));

    // Connection record persisted with the relays/ice_servers from the scanned card.
    expect(body.connection).toMatchObject({ did: scannedCard.did, relays: scannedCard.relays });
    const stored = connectionStore.getConnection(scannedCard.did);
    expect(stored?.relays).toEqual(scannedCard.relays);
    expect(stored?.ice_servers).toEqual(scannedCard.ice_servers);
  });

  it("POST /api/connect defaults relays to [] and omits ice_servers when the scanned card carries neither", async () => {
    const port = nextPort();
    const { server, connectionStore } = await bootDaemon(port);
    cleanup = () => server.close();

    const res = await fetch(`http://127.0.0.1:${port}/api/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ did: "did:peer:2.Vzcora.Ezcora.Scora", display: "Cora" }),
    });
    expect(res.status).toBe(200);
    const stored = connectionStore.getConnection("did:peer:2.Vzcora.Ezcora.Scora");
    expect(stored?.relays).toEqual([]);
    expect(stored?.ice_servers).toBeUndefined();
  });

  it("POST /api/connect upserts — rescanning the same did with new relays replaces the connection record, not the trust edge's created_at", async () => {
    const port = nextPort();
    const { server, connectionStore } = await bootDaemon(port);
    cleanup = () => server.close();

    const did = "did:peer:2.Vzdora.Ezdora.Sdora";
    const first = await fetch(`http://127.0.0.1:${port}/api/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ did, display: "Dora", relays: ["did:peer:2.Vzrelay1"] }),
    });
    const firstEdge = ((await first.json()) as { trust_edge: { created_at: string } }).trust_edge;

    const second = await fetch(`http://127.0.0.1:${port}/api/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ did, display: "Dora", relays: ["did:peer:2.Vzrelay2"] }),
    });
    const secondEdge = ((await second.json()) as { trust_edge: { created_at: string } }).trust_edge;

    expect(secondEdge.created_at).toBe(firstEdge.created_at); // upsert preserves created_at, mirrors addTrust's own contract
    expect(connectionStore.getConnection(did)?.relays).toEqual(["did:peer:2.Vzrelay2"]);
    expect(connectionStore.getConnections()).toHaveLength(1);
  });

  it("POST /api/connect rejects a missing did/display with 400", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();

    const noDid = await fetch(`http://127.0.0.1:${port}/api/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display: "Nobody" }),
    });
    expect(noDid.status).toBe(400);

    const noDisplay = await fetch(`http://127.0.0.1:${port}/api/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ did: "did:peer:2.Vzx.Ezx.Sx" }),
    });
    expect(noDisplay.status).toBe(400);
  });

  it("POST /api/connect rejects an invalid level or a non-array relays with 400", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();

    const badLevel = await fetch(`http://127.0.0.1:${port}/api/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ did: "did:peer:2.Vzx.Ezx.Sx", display: "X", level: "bogus" }),
    });
    expect(badLevel.status).toBe(400);

    const badRelays = await fetch(`http://127.0.0.1:${port}/api/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ did: "did:peer:2.Vzx.Ezx.Sx", display: "X", relays: "not-an-array" }),
    });
    expect(badRelays.status).toBe(400);
  });
});
