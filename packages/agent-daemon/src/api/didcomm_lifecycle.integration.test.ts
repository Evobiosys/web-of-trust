// Two-daemon-over-real-HTTP integration test (Task 11 DoD). Anna (asker) and
// Ben (owner) each run a real agent-daemon + a real DidCommTransport, wired
// through the SHIPPED api/server.ts `POST /didcomm` mount over localhost HTTP.
// The full request lifecycle completes end-to-end — REQUEST → STATUS(PENDING)
// → CONSENT → INTRO → room chat (LISTING/LOAN/DM) → WITHDRAWN — plus the
// GET /api/trust/export?format=vrc endpoint returns verifiable VRCs.
//
// Matching runs offline via the deterministic FakeEmbedClient (no ollama);
// timing is real (RealScheduler), so we poll and never assert immediately
// after a send.
import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ItemSchema, type Item } from "@resource-web/protocol";
import {
  DidCommTransport,
  createIdentity,
  issueVrc,
  verifyVrc,
  type Identity,
  type VerifiableRelationshipCredential,
} from "@resource-web/transport";
import { SqliteStore } from "../store/sqlite_store.js";
import { SystemClock, RealScheduler } from "../clock.js";
import { Daemon, type DaemonConfig } from "../daemon/daemon.js";
import { FakeEmbedClient, FakeChatClient } from "../daemon/test_harness.js";
import { startServer, type StartedServer } from "./server.js";

interface Node {
  daemon: Daemon;
  store: SqliteStore;
  identity: Identity;
  server: StartedServer;
  did: string;
}

const started: Node[] = [];

afterEach(async () => {
  for (const n of started.splice(0)) {
    await n.server.close();
    n.store.close();
  }
});

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function bootDaemon(persona: string, accent: string): Promise<Node> {
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}/didcomm`;
  const identity = createIdentity(endpoint);
  const store = new SqliteStore(":memory:");
  const transport = new DidCommTransport(identity);
  const clock = new SystemClock();

  const config: DaemonConfig = {
    personaName: persona,
    peerId: identity.did,
    accent,
    statusDelayMs: 150,
    defaultAskTtlMs: 3_600_000,
    matcher: { embedModel: "fake-embed", chatModel: "fake-chat", threshold: 0.6 },
  };

  const daemon = new Daemon({
    config,
    store,
    transport,
    scheduler: new RealScheduler(clock),
    clock,
    embedClient: new FakeEmbedClient(),
    chatClient: new FakeChatClient(),
  });
  await daemon.init();

  const server = await startServer(daemon, port, {
    didcommInbound: (rawBody: string) => transport.receiveInbound(rawBody),
    trustExport: (): VerifiableRelationshipCredential[] =>
      store.getTrustEdges().map((edge) => issueVrc(identity, { peerDid: edge.peer, relationship: "trusted" })),
  });

  const node: Node = { daemon, store, identity, server, did: identity.did };
  started.push(node);
  return node;
}

function screwdriver(): Item {
  return ItemSchema.parse({
    id: "screwdriver",
    labels: ["Bosch IXO cordless screwdriver", "Akkuschrauber"],
    description: "Small cordless screwdriver, barely used.",
    tags: [],
    provenance: { kind: "self" },
    policy: {},
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("Two daemons over real DidCommTransport (localhost HTTP)", () => {
  it("completes the full lifecycle REQUEST→PENDING→CONSENT→INTRO→room chat→WITHDRAWN", async () => {
    const anna = await bootDaemon("Anna", "warm");
    const ben = await bootDaemon("Ben", "steady");

    ben.store.putItem(screwdriver());
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    anna.store.putTrustEdge({ peer: ben.did, display: "Ben", level: "friend", created_at: nowIso, expires_at: expiresIso });
    ben.store.putTrustEdge({ peer: anna.did, display: "Anna", level: "friend", created_at: nowIso, expires_at: expiresIso });

    // Anna asks — REQUEST travels encrypted over real HTTP to Ben.
    const ask = await anna.daemon.sendAsk("Hat wer einen Akkuschrauber?");
    expect(ask.queried_count).toBe(1);

    // Ben's daemon receives REQUEST, matches (offline embeddings), raises a consent card.
    await waitFor(() => ben.daemon.getStateSnapshot().consent_cards.length === 1);
    const card = ben.daemon.getStateSnapshot().consent_cards[0];
    expect(card.requester.peer_id).toBe(anna.did); // owner sees asker identity (I4)
    expect(card.state).toBe("pending");

    // Ben consents. STATUS(PENDING) fires on the uniform delay, then CONSENT+INTRO.
    await ben.daemon.consent(card.card_id);

    // Anna's ask reaches room_open once INTRO arrives.
    await waitFor(() => anna.daemon.getStateSnapshot().asks[0]?.state === "room_open");
    const annaAsk = anna.daemon.getStateSnapshot().asks[0];
    const roomId = annaAsk.room_id!;
    expect(roomId).toBeTruthy();

    // Room chat both directions (LISTING / LOAN / DM as free text over the room thread).
    await ben.daemon.postRoomMessage(roomId, "LISTING: Bosch IXO, works great");
    await waitFor(() => anna.daemon.getStateSnapshot().rooms.find((r) => r.room_id === roomId)?.messages.length === 1);
    await anna.daemon.postRoomMessage(roomId, "LOAN: could I borrow it Saturday?");
    await ben.daemon.postRoomMessage(roomId, "DM: sure, come by at 10");
    await waitFor(() => {
      const benRoom = ben.daemon.getStateSnapshot().rooms.find((r) => r.room_id === roomId);
      return (benRoom?.messages.length ?? 0) >= 2; // Ben sees his own + Anna's LOAN
    });

    const annaRoom = anna.daemon.getStateSnapshot().rooms.find((r) => r.room_id === roomId)!;
    expect(annaRoom.messages.map((m) => m.text)).toEqual(["LISTING: Bosch IXO, works great", "LOAN: could I borrow it Saturday?", "DM: sure, come by at 10"]);

    // Anna withdraws (fulfilled) — WITHDRAWN travels to Ben.
    await anna.daemon.withdraw(ask.request_id, "fulfilled");
    expect(anna.daemon.getStateSnapshot().asks[0].state).toBe("withdrawn");
  });

  it("serves verifiable VRCs at GET /api/trust/export?format=vrc", async () => {
    const anna = await bootDaemon("Anna", "warm");
    const ben = await bootDaemon("Ben", "steady");
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    anna.store.putTrustEdge({ peer: ben.did, display: "Ben", level: "friend", created_at: nowIso, expires_at: expiresIso });

    const res = await fetch(`http://127.0.0.1:${anna.server.port}/api/trust/export?format=vrc`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credentials: VerifiableRelationshipCredential[] };
    expect(body.credentials).toHaveLength(1);
    const vrc = body.credentials[0];
    expect(vrc.issuer).toBe(anna.did);
    expect(vrc.credentialSubject.id).toBe(ben.did);
    expect(verifyVrc(vrc)).toEqual({ valid: true, issuer: anna.did, subject: ben.did });
  });

  it("rejects a non-vrc export format with 400", async () => {
    const anna = await bootDaemon("Anna", "warm");
    const res = await fetch(`http://127.0.0.1:${anna.server.port}/api/trust/export?format=json`);
    expect(res.status).toBe(400);
  });
});
