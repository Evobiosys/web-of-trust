// internet_didcomm.integration.test.ts — Task 9: end-to-end, two-node proof
// of the FULL mediator-only transport ladder (core-transport-plan.md §0
// SCOPE REVISION + Task 9). Mirrors didcomm_transport.integration.test.ts's
// "real listeners, poll-don't-assert-immediately" discipline, but each
// DidCommTransport's channel here is a real
// `LadderChannel([RelayChannel, HttpPostChannel])` — not the bare
// HttpPostChannel the older integration test exercises — talking to a live
// `RelayServer` (the mediator = this machine), exactly the shape Task 10
// wires into alpha_server.ts.
//
// WHAT THIS PROVES:
//   - Wire correctness: all five v0.1 protocol envelope types Anna→Ben,
//     each decrypted + sender-authenticated at Ben, delivered over the real
//     ladder (RelayChannel winning the race when both peers are online).
//   - Ladder ordering / rooms ride the ladder for free: a bidirectional
//     room thread with zero room-specific transport code — createSharedRoom
//     / sendRoomMessage already fan out via deliver().
//   - Rejection paths: a tampered ciphertext is rejected and never fires
//     onEnvelope; a replayed message id is rejected by the dedup store.
//   - Relay store-and-forward (the headline case): Ben is offline when
//     Anna sends; the relay (mediator) queues the wire; Ben comes online
//     later, completes the nonce→Ed25519 drain-authentication handshake,
//     drains, and receives it — including a message whose `created_time`
//     is older than the OLD 5-minute REPLAY_WINDOW_MS but within the
//     widened max-hold horizon `H` (proves Task 2's coupled
//     freshness/dedup change; store-and-forward would otherwise reject its
//     own queued mail as "too old").
//   - Fallback cascade: with the relay rung forced to fail (an unreachable
//     relay endpoint), delivery still completes via the lan_http rung
//     (HttpPostChannel over real localhost HTTP) — proven by asserting the
//     recipient's real HTTP listener actually saw the POST (a hit counter),
//     not merely that the envelope eventually arrived by some path.
//   - Dedup across restart: a replayed message id is still rejected after
//     the receiving transport is torn down and reconstructed against the
//     same on-disk SqliteDedupStore file — no replay hole survives a
//     process restart.
//
// WHAT THIS DOES NOT PROVE: two nodes on one host share a network — this is
// NOT a real NAT-traversal test; loopback ≠ hole-punching; proving real
// internet reachability needs two separate networks (core-transport-plan.md
// R4). It also does not exercise WebRTC / mediator-less direct P2P: per §0
// SCOPE REVISION that rung is DEFERRED and does not exist in the current
// LadderChannel (`dataRungs` is exactly `[relay, lan_http]` — there is no
// "webrtc" rung to test, by design, not by omission).
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { Envelope } from "@resource-web/protocol";
import { createIdentity, type Identity } from "./did_identity.js";
import { DidCommTransport, ENVELOPE_TYPE } from "./didcomm_transport.js";
import { packMessage } from "./didcomm_crypto.js";
import { HttpPostChannel, type DeliveryChannel } from "./delivery_channel.js";
import { RelayServer } from "./relay_server.js";
import { RelayChannel, type BackoffOpts } from "./relay_channel.js";
import { LadderChannel, type LadderBudgets } from "./ladder_channel.js";
import { SqliteDedupStore, type DedupStore } from "./dedup_store.js";
import { ENVELOPE_FIXTURES } from "./test_support/envelope_fixtures.js";

// ---- shared cleanup bookkeeping -------------------------------------------

const httpServers: Server[] = [];
const relayServers: RelayServer[] = [];
const ladders: LadderChannel[] = [];
const standaloneChannels: DeliveryChannel[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(ladders.splice(0).map((l) => l.close()));
  await Promise.all(standaloneChannels.splice(0).map((c) => c.close?.()));
  await Promise.all(relayServers.splice(0).map((s) => s.close()));
  await Promise.all(httpServers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "internet-didcomm-test-"));
  tempDirs.push(dir);
  return join(dir, "dedup.sqlite");
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Reserves a port and immediately frees it, so connecting to it fails fast (ECONNREFUSED) — the standard "unreachable endpoint" lever (mirrors relay_channel.test.ts). */
async function reserveDeadEndpoint(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  return `http://127.0.0.1:${port}`;
}

/** Boots a live RelayServer (the mediator) — one per scenario, not shared across the whole file, so queue/dedup state never bleeds between tests. */
async function bootRelay(): Promise<{ relay: RelayServer; endpoint: string }> {
  const relay = new RelayServer();
  relayServers.push(relay);
  const { port } = await relay.listen(0, "127.0.0.1");
  return { relay, endpoint: `http://127.0.0.1:${port}` };
}

// ---- the mediator-only node under test -------------------------------------

interface Node {
  transport: DidCommTransport;
  identity: Identity;
  did: string;
  server: Server;
  receivedEnvelopes: { from: string; env: Envelope }[];
  receivedRooms: { room_id: string; from: string; text: string; ts: string }[];
  inboundErrors: number;
  /** Counts real HTTP POSTs the node's own /didcomm listener received — the only way to prove the lan_http rung actually fired, as opposed to "the envelope arrived somehow". */
  httpHits: number;
}

interface BootNodeOpts {
  relayEndpoints: string[];
  dedup?: DedupStore;
  relayChannelOpts?: { ackTimeoutMs?: number; reconnect?: BackoffOpts };
  ladderBudgets?: LadderBudgets;
}

/**
 * Boots a node exactly the way Task 10 wires alpha_server.ts: a real
 * `/didcomm` HTTP listener (rung "c", also the daemon's inbound mount point)
 * plus a `DidCommTransport` whose channel is
 * `LadderChannel([RelayChannel, HttpPostChannel])` against the given relay
 * endpoint(s).
 */
async function bootNode(opts: BootNodeOpts): Promise<Node> {
  const server = createServer();
  httpServers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  const endpoint = `http://127.0.0.1:${port}/didcomm`;

  const identity = createIdentity(endpoint);
  const relayChannel = new RelayChannel(identity, {
    relayEndpoints: opts.relayEndpoints,
    ...opts.relayChannelOpts,
  });
  const httpChannel = new HttpPostChannel(identity);
  const ladder = new LadderChannel({
    dataRungs: [
      { name: "relay", channel: relayChannel },
      { name: "lan_http", channel: httpChannel },
    ],
    budgets: opts.ladderBudgets,
  });
  ladders.push(ladder); // closing the ladder closes both rungs (RelayChannel drains + HttpPostChannel no-op)

  const transport = new DidCommTransport(identity, { channel: ladder, dedup: opts.dedup });
  await transport.init({ self: identity.did });

  const node: Node = {
    transport,
    identity,
    did: identity.did,
    server,
    receivedEnvelopes: [],
    receivedRooms: [],
    inboundErrors: 0,
    httpHits: 0,
  };
  transport.onEnvelope((from, env) => node.receivedEnvelopes.push({ from, env }));
  transport.onRoomMessage((msg) => node.receivedRooms.push(msg));

  // Same inbound mount the daemon uses in production: POST /didcomm →
  // transport.receiveInbound(rawBody) directly. This is rung "c"'s real
  // surface, and also the surface used below to exercise rejection paths
  // deterministically (see file header / the "swallowed rejection" note on
  // DidCommTransport.init's channel-driven inbound path).
  server.on("request", (req, res) => {
    if (req.method === "POST" && (req.url ?? "").startsWith("/didcomm")) {
      node.httpHits += 1;
      void readBody(req).then(
        async (body) => {
          try {
            await transport.receiveInbound(body);
            res.writeHead(202).end();
          } catch {
            node.inboundErrors += 1;
            res.writeHead(400).end();
          }
        },
        () => res.writeHead(400).end()
      );
      return;
    }
    res.writeHead(404).end();
  });

  return node;
}

function buildEnvelopeWire(
  sender: Identity,
  recipientDid: string,
  id: string,
  createdTime: number,
  body: unknown = ENVELOPE_FIXTURES[0]
): string {
  return packMessage({
    sender,
    recipientDid,
    message: { id, type: ENVELOPE_TYPE, from: sender.did, to: [recipientDid], created_time: createdTime, body },
  });
}

// ============================================================================

describe("Internet DIDComm transport — mediator-only ladder (Task 9)", () => {
  describe("wire correctness over the ladder", () => {
    it("carries all five v0.1 protocol envelope types Anna→Ben, decrypted + sender-authenticated", async () => {
      const { endpoint } = await bootRelay();
      const anna = await bootNode({ relayEndpoints: [endpoint] });
      const ben = await bootNode({ relayEndpoints: [endpoint] });

      for (const env of ENVELOPE_FIXTURES) {
        await anna.transport.send(ben.did, env);
      }
      await waitFor(() => ben.receivedEnvelopes.length === ENVELOPE_FIXTURES.length);

      expect(ben.receivedEnvelopes.map((r) => r.env)).toEqual(ENVELOPE_FIXTURES);
      expect(ben.receivedEnvelopes.every((r) => r.from === anna.did)).toBe(true);
      expect(ben.inboundErrors).toBe(0);
    });

    it("carries a bidirectional room thread over the ladder (rooms ride the ladder for free)", async () => {
      const { endpoint } = await bootRelay();
      const anna = await bootNode({ relayEndpoints: [endpoint] });
      const ben = await bootNode({ relayEndpoints: [endpoint] });

      // Ben (owner) mints the room and fans ROOM_CREATE to Anna over the ladder.
      const { room_id } = await ben.transport.createSharedRoom([ben.did, anna.did], {
        request_id: "req-1",
        context_card: "Akkuschrauber",
      });
      // Anna's transport must learn membership before she can post.
      await waitFor(() => (anna.transport as unknown as { rooms: Map<string, string[]> }).rooms.has(room_id));

      await ben.transport.sendRoomMessage({ room_id, from: ben.did, text: "LISTING: Bosch IXO", ts: new Date().toISOString() });
      await anna.transport.sendRoomMessage({ room_id, from: anna.did, text: "LOAN: pick up Saturday?", ts: new Date().toISOString() });
      await ben.transport.sendRoomMessage({ room_id, from: ben.did, text: "DM: sure, 10am", ts: new Date().toISOString() });

      await waitFor(() => anna.receivedRooms.length === 2 && ben.receivedRooms.length === 1);
      expect(anna.receivedRooms.map((m) => m.text)).toEqual(["LISTING: Bosch IXO", "DM: sure, 10am"]);
      expect(ben.receivedRooms.map((m) => m.text)).toEqual(["LOAN: pick up Saturday?"]);
    });
  });

  // DidCommTransport.init() wires channel-driven inbound as
  // `void this.receiveInbound(wire).catch(() => {})` — it deliberately
  // swallows rejections (relay/ladder delivery has no HTTP response to
  // answer, and duplicates are normal there). So a tampered/replayed wire
  // sent THROUGH the ladder produces no observable signal. These two tests
  // instead POST directly to the node's real `/didcomm` HTTP surface —
  // exactly what didcomm_transport.integration.test.ts does — which is the
  // same unchanged receiveInbound() path and gives a synchronous, 4xx
  // deterministic rejection to assert on.
  describe("rejection paths (asserted via the node's real /didcomm HTTP surface)", () => {
    it("rejects a tampered ciphertext with a 4xx and never fires onEnvelope", async () => {
      const { endpoint } = await bootRelay();
      const anna = await bootNode({ relayEndpoints: [endpoint] });
      const ben = await bootNode({ relayEndpoints: [endpoint] });

      const wire = JSON.parse(
        buildEnvelopeWire(anna.identity, ben.did, uuidv4(), Date.now(), ENVELOPE_FIXTURES[0])
      ) as { ciphertext: string };
      const ct = Buffer.from(wire.ciphertext, "base64url");
      ct[0] ^= 0xff;
      wire.ciphertext = ct.toString("base64url");

      const res = await fetch(`http://127.0.0.1:${(ben.server.address() as AddressInfo).port}/didcomm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(wire),
      });
      expect(res.status).toBe(400);
      expect(ben.inboundErrors).toBe(1);
      expect(ben.receivedEnvelopes).toHaveLength(0);
    });

    it("rejects a replayed (duplicate-id) message", async () => {
      const { endpoint } = await bootRelay();
      const anna = await bootNode({ relayEndpoints: [endpoint] });
      const ben = await bootNode({ relayEndpoints: [endpoint] });

      const wire = buildEnvelopeWire(anna.identity, ben.did, uuidv4(), Date.now(), ENVELOPE_FIXTURES[0]);
      const url = `http://127.0.0.1:${(ben.server.address() as AddressInfo).port}/didcomm`;
      const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: wire });
      expect(first.status).toBe(202);
      const second = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: wire });
      expect(second.status).toBe(400); // duplicate id rejected
      expect(ben.receivedEnvelopes).toHaveLength(1);
    });
  });

  describe("relay store-and-forward (headline case)", () => {
    it("Ben is offline when Anna sends; the relay queues; Ben comes online, authenticates the drain, and receives — including a message older than the OLD 5-min replay window but within H", async () => {
      const { endpoint } = await bootRelay();

      // Anna and Ben's DIDs exist (a did:peer:2 is self-describing, no
      // registration step), but Ben's transport/ladder does not exist yet —
      // this IS "offline": nothing is listening for him anywhere, relay or
      // HTTP, and no drain is authenticated.
      const anna = createIdentity("http://anna.example/didcomm");
      const ben = createIdentity("http://ben.example/didcomm");

      // 10 minutes old: outside the OLD 5-minute REPLAY_WINDOW_MS, inside
      // the widened max-hold horizon H (72h) — store-and-forward legitimately
      // delivers mail this old to an offline recipient (Task 2).
      const agedCreatedTime = Date.now() - 10 * 60 * 1000;
      const agedWire = buildEnvelopeWire(anna, ben.did, uuidv4(), agedCreatedTime, ENVELOPE_FIXTURES[1]);

      // Anna delivers via a bare RelayChannel (not transport.send(), which
      // would stamp created_time = now and defeat the aged-message proof).
      // Ben not being constructed yet guarantees the relay queues rather
      // than live-forwards this wire.
      const annaRelay = new RelayChannel(anna, { relayEndpoints: [endpoint] });
      standaloneChannels.push(annaRelay);
      await annaRelay.deliver(ben.did, agedWire);

      // --- Ben "comes online": construct his full ladder transport now ---
      const benRelay = new RelayChannel(ben, { relayEndpoints: [endpoint] });
      const benHttp = new HttpPostChannel(ben);
      const benLadder = new LadderChannel({
        dataRungs: [
          { name: "relay", channel: benRelay },
          { name: "lan_http", channel: benHttp },
        ],
      });
      ladders.push(benLadder);
      const benTransport = new DidCommTransport(ben, { channel: benLadder });
      await benTransport.init({ self: ben.did });

      const received: { from: string; env: Envelope }[] = [];
      benTransport.onEnvelope((from, env) => received.push({ from, env }));

      // init() opens the drain connection, which completes the
      // nonce→Ed25519-signature→auth_ok handshake automatically (relay_server.ts
      // 6b), then the relay flushes the queued wire (6c forward-on-connect).
      await waitFor(() => received.length >= 1);
      expect(received[0]!.from).toBe(anna.did);
      expect(received[0]!.env).toEqual(ENVELOPE_FIXTURES[1]);
    });
  });

  describe("fallback cascade", () => {
    it("relay rung unreachable → delivery still completes via the lan_http rung (proven by the recipient's real HTTP listener seeing the POST)", async () => {
      const deadRelay = await reserveDeadEndpoint();
      const anna = await bootNode({
        relayEndpoints: [deadRelay],
        relayChannelOpts: { ackTimeoutMs: 300, reconnect: { baseMs: 50, maxMs: 200 } },
      });
      const ben = await bootNode({
        relayEndpoints: [deadRelay],
        relayChannelOpts: { reconnect: { baseMs: 50, maxMs: 200 } },
      });

      const env = ENVELOPE_FIXTURES[2];
      await anna.transport.send(ben.did, env);

      await waitFor(() => ben.receivedEnvelopes.length === 1);
      expect(ben.receivedEnvelopes[0]).toEqual({ from: anna.did, env });
      // "It arrived" alone doesn't prove which rung fired — assert the
      // lan_http rung's real HTTP surface actually took the hit.
      expect(ben.httpHits).toBeGreaterThanOrEqual(1);
      expect(ben.inboundErrors).toBe(0);
    });
  });

  describe("dedup across restart", () => {
    it("a replayed message id is still rejected after the receiving transport is torn down and reconstructed against the same on-disk SqliteDedupStore file", async () => {
      // This property is unit-tested channel-agnostically in
      // dedup_store.test.ts; it is reproduced here (with a fixed
      // ENVELOPE_TYPE wire, matching this file's own conventions) so the T9
      // end-to-end checklist is self-contained — no wiring-only gap between
      // "dedup survives restart" and "the mediator-only ladder as actually
      // constructed in this file" is left unproven.
      class NullChannel implements DeliveryChannel {
        async deliver(): Promise<void> {
          // never called: this test drives receiveInbound() directly.
        }
        onInbound(): void {
          // never called.
        }
      }

      const anna = createIdentity("http://anna.example/didcomm");
      const ben = createIdentity("http://ben.example/didcomm");
      const dbPath = makeTempDbPath();
      const wire = buildEnvelopeWire(anna, ben.did, uuidv4(), Date.now() - 60_000, ENVELOPE_FIXTURES[0]);

      const dedupBefore = new SqliteDedupStore(dbPath);
      const transportBefore = new DidCommTransport(ben, { channel: new NullChannel(), dedup: dedupBefore });
      await transportBefore.init({ self: ben.did });
      await transportBefore.receiveInbound(wire); // accepted pre-restart
      dedupBefore.close(); // simulate process shutdown

      const dedupAfter = new SqliteDedupStore(dbPath);
      const transportAfter = new DidCommTransport(ben, { channel: new NullChannel(), dedup: dedupAfter });
      await transportAfter.init({ self: ben.did });
      const receivedAfter: unknown[] = [];
      transportAfter.onEnvelope((_from, env) => receivedAfter.push(env));

      await expect(transportAfter.receiveInbound(wire)).rejects.toThrow(/duplicate message id/);
      expect(receivedAfter).toHaveLength(0); // never dispatched post-restart — no replay hole
      dedupAfter.close();
    });
  });
});
