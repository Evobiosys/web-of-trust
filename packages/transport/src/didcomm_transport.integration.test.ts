// Integration test — two real DidCommTransport instances over REAL localhost
// HTTP (node:http listeners), each mounting the same inbound handler the
// daemon mounts at POST /didcomm. Proves the full sign-then-encrypt path
// carries every protocol envelope type + room chat, and that tamper/replay
// are rejected. HTTP delivery is async → we always poll, never assert
// immediately after send().
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Envelope } from "@resource-web/protocol";
import { createIdentity } from "./did_identity.js";
import { DidCommTransport } from "./didcomm_transport.js";
import { packMessage } from "./didcomm_crypto.js";
import { ENVELOPE_FIXTURES } from "./test_support/envelope_fixtures.js";

interface Node {
  transport: DidCommTransport;
  did: string;
  server: Server;
  receivedEnvelopes: { from: string; env: Envelope }[];
  receivedRooms: { room_id: string; from: string; text: string; ts: string }[];
  inboundErrors: number;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Boots a transport with its own /didcomm HTTP listener; endpoint is fixed into its DID. */
async function bootNode(): Promise<Node> {
  // Reserve a port first so the endpoint can be baked into the DID.
  const server = createServer();
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  const endpoint = `http://127.0.0.1:${port}/didcomm`;

  const identity = createIdentity(endpoint);
  const transport = new DidCommTransport(identity);
  await transport.init({ self: identity.did });

  const node: Node = { transport, did: identity.did, server, receivedEnvelopes: [], receivedRooms: [], inboundErrors: 0 };
  transport.onEnvelope((from, env) => node.receivedEnvelopes.push({ from, env }));
  transport.onRoomMessage((msg) => node.receivedRooms.push(msg));

  server.on("request", (req, res) => {
    if (req.method === "POST" && (req.url ?? "").startsWith("/didcomm")) {
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

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("DidCommTransport over real HTTP", () => {
  it("carries all five protocol envelope types Anna→Ben, decrypted + sender-authenticated", async () => {
    const anna = await bootNode();
    const ben = await bootNode();

    for (const env of ENVELOPE_FIXTURES) {
      await anna.transport.send(ben.did, env);
    }
    await waitFor(() => ben.receivedEnvelopes.length === ENVELOPE_FIXTURES.length);

    // Every fixture arrived, byte-equal, attributed to Anna's DID.
    expect(ben.receivedEnvelopes.map((r) => r.env)).toEqual(ENVELOPE_FIXTURES);
    expect(ben.receivedEnvelopes.every((r) => r.from === anna.did)).toBe(true);
    expect(ben.inboundErrors).toBe(0);
  });

  it("carries a bidirectional room thread (LISTING / LOAN / DM as room chat) after a shared room is created", async () => {
    const anna = await bootNode();
    const ben = await bootNode();

    // Ben (owner) mints the room and fans ROOM_CREATE to Anna.
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

  it("rejects a tampered ciphertext (bad signature/AEAD) with a 4xx and never fires onEnvelope", async () => {
    const anna = await bootNode();
    const ben = await bootNode();

    const wire = JSON.parse(packMessage({
      sender: (anna.transport as unknown as { identity: import("./did_identity.js").Identity }).identity,
      recipientDid: ben.did,
      message: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", type: "https://didcomm.org/resource-web/2.0/envelope", from: anna.did, to: [ben.did], created_time: Date.now(), body: ENVELOPE_FIXTURES[0] },
    }));
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
    const anna = await bootNode();
    const ben = await bootNode();

    const wire = packMessage({
      sender: (anna.transport as unknown as { identity: import("./did_identity.js").Identity }).identity,
      recipientDid: ben.did,
      message: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", type: "https://didcomm.org/resource-web/2.0/envelope", from: anna.did, to: [ben.did], created_time: Date.now(), body: ENVELOPE_FIXTURES[0] },
    });
    const url = `http://127.0.0.1:${(ben.server.address() as AddressInfo).port}/didcomm`;
    const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: wire });
    expect(first.status).toBe(202);
    const second = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: wire });
    expect(second.status).toBe(400); // duplicate id rejected
    expect(ben.receivedEnvelopes).toHaveLength(1);
  });
});
