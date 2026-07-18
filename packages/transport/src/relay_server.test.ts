// relay_server.test.ts — Task 6's required test list, plus supporting
// coverage for the drain-auth security boundary and 6c liveness. Runs a
// real RelayServer over real localhost HTTP + WS (RelayServer.listen()),
// exercised with real did:peer:2 identities and real packMessage() wires —
// mirrors didcomm_transport.integration.test.ts's "real listeners,
// poll-don't-assert-immediately" discipline.
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import { parseEnvelope } from "@resource-web/protocol";
import { createIdentity, type Identity } from "./did_identity.js";
import { packMessage, unpackMessage } from "./didcomm_crypto.js";
import { ENVELOPE_TYPE } from "./didcomm_transport.js";
import { ENVELOPE_FIXTURES } from "./test_support/envelope_fixtures.js";
import { RelayServer, type RelayServerOptions } from "./relay_server.js";

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function unb64u(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

const servers: RelayServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
  }
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function bootRelay(opts?: RelayServerOptions): Promise<{ relay: RelayServer; port: number }> {
  const relay = new RelayServer(opts);
  servers.push(relay);
  const { port } = await relay.listen(0, "127.0.0.1");
  return { relay, port };
}

async function submitOverHttp(port: number, wire: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}/relay/send`, { method: "POST", body: wire });
  const body = await res.json();
  return { status: res.status, body };
}

interface DrainMessage {
  type: string;
  [k: string]: unknown;
}

/** Opens a drain WS, waits for the challenge, and returns a handle for driving the rest of the auth/drain flow. */
function openDrain(port: number, opts?: { autoPong?: boolean }): { ws: WebSocket; messages: DrainMessage[]; challenge: Promise<string> } {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/relay/drain`, opts);
  sockets.push(ws);
  const messages: DrainMessage[] = [];
  let resolveChallenge!: (nonce: string) => void;
  const challenge = new Promise<string>((resolve) => {
    resolveChallenge = resolve;
  });
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as DrainMessage;
    messages.push(msg);
    if (msg.type === "challenge") resolveChallenge(msg.nonce as string);
  });
  return { ws, messages, challenge };
}

async function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Authenticate as `identity` on an already-open drain socket using its REAL signing key. */
async function authenticate(drain: ReturnType<typeof openDrain>, identity: Identity): Promise<void> {
  const nonce = await drain.challenge;
  const sig = ed25519.sign(unb64u(nonce), identity.signing.secretKey);
  drain.ws.send(JSON.stringify({ type: "auth", did: identity.did, sig: b64u(sig) }));
}

function buildWire(sender: Identity, recipient: Identity, id: string, createdTime = Date.now()): string {
  return packMessage({
    sender,
    recipientDid: recipient.did,
    message: {
      id,
      type: ENVELOPE_TYPE,
      from: sender.did,
      to: [recipient.did],
      created_time: createdTime,
      body: ENVELOPE_FIXTURES[0],
    },
  });
}

describe("RelayServer — Task 6a: accept + persist + route", () => {
  it("a message for an offline DID is queued, then delivered verbatim once that DID authenticates and drains", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay();

    const wire = buildWire(anna, ben, "offline-msg-1");
    const submitRes = await submitOverHttp(port, wire);
    expect(submitRes.status).toBe(202);
    expect((submitRes.body as { routed: string }).routed).toBe("queued"); // Ben wasn't connected

    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);

    await waitFor(() => drain.messages.some((m) => m.type === "wire"));
    const wireMsg = drain.messages.find((m) => m.type === "wire")!;
    expect(wireMsg.wire).toBe(wire); // byte-identical to what was submitted

    // The recipient can decrypt it exactly as if it had arrived directly.
    const unpacked = unpackMessage({ recipient: ben, wire: wireMsg.wire as string });
    expect(unpacked.from).toBe(anna.did);
    expect(unpacked.message.id).toBe("offline-msg-1");
  });

  it("queued wire is byte-identical to the sent wire and does not parse as a protocol Envelope (the relay cannot read plaintext)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { relay, port } = await bootRelay();
    void relay;

    const wire = buildWire(anna, ben, "opaque-check");
    await submitOverHttp(port, wire);

    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "wire"));

    const stored = drain.messages.find((m) => m.type === "wire")!.wire as string;
    expect(stored).toBe(wire);
    // The outer wire is ciphertext-shaped ({typ,alg,epk,nonce,ciphertext,to}),
    // never a protocol Envelope — parsing it as one must fail.
    expect(() => parseEnvelope(stored)).toThrow();
  });

  it("a message for a DID this relay does not route reports failure synchronously (so a caller can fall back to the next ladder rung)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm"); // routable
    const stranger = createIdentity("http://stranger.example/didcomm"); // NOT routable

    const { relay, port } = await bootRelay({ isRoutable: (did) => did === ben.did });

    const routedResult = relay.submit(buildWire(anna, ben, "routable-1"));
    expect(routedResult.routed).not.toBe("rejected");

    const wire = buildWire(anna, stranger, "unroutable-1");
    const directResult = relay.submit(wire);
    expect(directResult).toEqual({ routed: "rejected", reason: expect.stringContaining("no route") });

    const httpResult = await submitOverHttp(port, wire);
    expect(httpResult.status).toBe(404);
    expect((httpResult.body as { reason: string }).reason).toMatch(/no route/);
  });

  it("a malformed wire (not JSON, or missing outer 'to') is rejected without touching the queue", async () => {
    const { relay } = await bootRelay();
    expect(relay.submit("not json at all").routed).toBe("rejected");
    expect(relay.submit(JSON.stringify({ ciphertext: "x" })).routed).toBe("rejected"); // no `to`
  });

  it("submitting while the recipient is already connected and authenticated delivers live (routed: 'live')", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay();

    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "auth_ok"));

    const wire = buildWire(anna, ben, "live-msg-1");
    const submitRes = await submitOverHttp(port, wire);
    expect((submitRes.body as { routed: string }).routed).toBe("live");

    await waitFor(() => drain.messages.some((m) => m.type === "wire"));
    expect(drain.messages.find((m) => m.type === "wire")!.wire).toBe(wire);
  });
});

describe("RelayServer — Task 6b: authenticated drain (spoof rejection)", () => {
  it("a drain whose signature does not match the claimed DID is rejected: no auth_ok, no wire leak, socket closes", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm"); // the real owner of the target queue
    const mallory = createIdentity("http://mallory.example/didcomm"); // attacker, signs with their OWN key
    const { port } = await bootRelay();

    // A message is waiting for Ben.
    const wire = buildWire(anna, ben, "targeted-msg");
    await submitOverHttp(port, wire);

    // Mallory connects, claims to be Ben, but signs the nonce with Mallory's key.
    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    const nonce = await drain.challenge;
    const forgedSig = ed25519.sign(unb64u(nonce), mallory.signing.secretKey);
    drain.ws.send(JSON.stringify({ type: "auth", did: ben.did, sig: b64u(forgedSig) }));

    await waitFor(() => drain.messages.some((m) => m.type === "auth_failed"));
    // Give any (incorrect) flush a moment to happen if the implementation were buggy.
    await new Promise((r) => setTimeout(r, 100));
    expect(drain.messages.some((m) => m.type === "auth_ok")).toBe(false);
    expect(drain.messages.some((m) => m.type === "wire")).toBe(false); // no queue leak
    await waitFor(() => drain.ws.readyState === WebSocket.CLOSED);

    // Ben's message must still be intact — nothing was lost or leaked to the impostor.
    const realDrain = openDrain(port);
    await waitForOpen(realDrain.ws);
    await authenticate(realDrain, ben);
    await waitFor(() => realDrain.messages.some((m) => m.type === "wire"));
    expect(realDrain.messages.find((m) => m.type === "wire")!.wire).toBe(wire);
  });

  it("a drain with a syntactically well-formed but cryptographically wrong signature (right DID, garbage sig bytes) is rejected", async () => {
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay();
    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await drain.challenge;
    drain.ws.send(JSON.stringify({ type: "auth", did: ben.did, sig: b64u(new Uint8Array(64)) }));
    await waitFor(() => drain.messages.some((m) => m.type === "auth_failed"));
  });

  it("two-hop: Anna sends to Ben via the relay (their common friend); the relay never decrypts and Ben receives Anna's authenticated message after draining", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay({ isRoutable: (did) => did === ben.did });

    // Anna and Ben are not directly connected to one another at all — only
    // to the relay. This is exactly the two-hop shape: Anna -> relay -> Ben.
    const wire = buildWire(anna, ben, "two-hop-msg");
    const submitRes = await submitOverHttp(port, wire);
    expect(submitRes.status).toBe(202);

    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "wire"));

    const received = drain.messages.find((m) => m.type === "wire")!.wire as string;
    const unpacked = unpackMessage({ recipient: ben, wire: received });
    expect(unpacked.from).toBe(anna.did); // sender authenticity survives the hop
    expect(unpacked.message.id).toBe("two-hop-msg");
  });
});

describe("RelayServer — DoS hardening: auth deadline + max wire size", () => {
  it("a drain socket that never completes auth within the deadline is closed by the server", async () => {
    const { port } = await bootRelay({ authDeadlineMs: 40 });

    // Open the socket and receive the challenge, but never send `auth`.
    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await drain.challenge;
    expect(drain.ws.readyState).toBe(WebSocket.OPEN);

    // The auth-deadline timer (not the heartbeat) must reap this idle,
    // never-authenticated socket.
    await waitFor(() => drain.ws.readyState === WebSocket.CLOSED, 2000);
    expect(drain.messages.some((m) => m.type === "auth_ok")).toBe(false);
  });

  it("a body exceeding MAX_WIRE_BYTES is rejected (413) and nothing is enqueued", async () => {
    const ben = createIdentity("http://ben.example/didcomm");
    const { relay, port } = await bootRelay({ maxWireBytes: 1024 });

    const oversized = JSON.stringify({ to: ben.did, ciphertext: "x".repeat(2000) });
    expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(1024);

    const res = await fetch(`http://127.0.0.1:${port}/relay/send`, { method: "POST", body: oversized });
    expect(res.status).toBe(413);

    // Nothing was enqueued: an authenticated drain for `ben` sees no wire.
    const drain = openDrain(port);
    await waitForOpen(drain.ws);
    await authenticate(drain, ben);
    await waitFor(() => drain.messages.some((m) => m.type === "auth_ok"));
    await new Promise((r) => setTimeout(r, 150));
    expect(drain.messages.some((m) => m.type === "wire")).toBe(false);

    void relay;
  });
});

describe("RelayServer — Task 6c: forward-on-connect, ack, and liveness", () => {
  it("acking a delivered wire removes it from the queue; a second drain (reconnect) does not redeliver it", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay();

    const wire = buildWire(anna, ben, "ack-once");
    await submitOverHttp(port, wire);

    const drain1 = openDrain(port);
    await waitForOpen(drain1.ws);
    await authenticate(drain1, ben);
    await waitFor(() => drain1.messages.some((m) => m.type === "wire"));
    const id = drain1.messages.find((m) => m.type === "wire")!.id as string;
    drain1.ws.send(JSON.stringify({ type: "ack", ids: [id] }));
    await new Promise((r) => setTimeout(r, 100)); // let the ack land server-side
    drain1.ws.close();

    const drain2 = openDrain(port);
    await waitForOpen(drain2.ws);
    await authenticate(drain2, ben);
    await waitFor(() => drain2.messages.some((m) => m.type === "auth_ok"));
    await new Promise((r) => setTimeout(r, 150)); // no further "wire" should ever arrive
    expect(drain2.messages.some((m) => m.type === "wire")).toBe(false);
  });

  it("an unacked wire is redelivered after the drain disconnects and reconnects (re-enqueue on disconnect)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay();

    const wire = buildWire(anna, ben, "unacked-msg");
    await submitOverHttp(port, wire);

    const drain1 = openDrain(port);
    await waitForOpen(drain1.ws);
    await authenticate(drain1, ben);
    await waitFor(() => drain1.messages.some((m) => m.type === "wire"));
    drain1.ws.terminate(); // dies before acking — no clean close

    const drain2 = openDrain(port);
    await waitForOpen(drain2.ws);
    await authenticate(drain2, ben);
    await waitFor(() => drain2.messages.some((m) => m.type === "wire"));
    expect(drain2.messages.find((m) => m.type === "wire")!.wire).toBe(wire); // redelivered, still verbatim
  });

  it("heartbeat reclaims a drain slot for an unresponsive (non-pong-answering) socket, allowing a fresh connection to authenticate and drain", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const { port } = await bootRelay({ heartbeatIntervalMs: 40 });

    // Simulate a hung connection: stop answering pings at the protocol level
    // (autoPong: false) instead of a clean close, so only the heartbeat can
    // detect and reclaim it.
    const drain1 = openDrain(port, { autoPong: false });
    await waitForOpen(drain1.ws);
    await authenticate(drain1, ben);
    await waitFor(() => drain1.messages.some((m) => m.type === "auth_ok"));

    // Two missed heartbeat ticks should be enough for the server to terminate it.
    await waitFor(() => drain1.ws.readyState === WebSocket.CLOSED, 2000);

    // A message arriving after the dead drain is reclaimed queues normally...
    const wire = buildWire(anna, ben, "post-heartbeat-msg");
    await submitOverHttp(port, wire);

    // ...and a fresh, responsive connection can authenticate and drain it.
    const drain2 = openDrain(port);
    await waitForOpen(drain2.ws);
    await authenticate(drain2, ben);
    await waitFor(() => drain2.messages.some((m) => m.type === "wire"));
    expect(drain2.messages.find((m) => m.type === "wire")!.wire).toBe(wire);
  });
});
