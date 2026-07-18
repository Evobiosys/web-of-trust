// RelayServer — trust-graph relay/mediator: a store-and-forward node a
// daemon runs so it can relay opaque wire messages for its friends
// (core-transport-plan.md Task 6, §1 rule 6: "a trust-graph node you
// already trust, not a neutral third party").
//
// Two responsibilities, deliberately kept separate:
//
//   ingress (6a) — submit(rawWire): read ONLY the outer `to` field (the
//   cleartext routing envelope produced by didcomm_crypto.ts's
//   packMessage — {typ,alg,epk,nonce,ciphertext,to}) to decide where the
//   wire goes. The ciphertext is never touched, never decrypted, and the
//   wire is never parsed as a protocol Envelope — this relay cannot read
//   plaintext even if it wanted to.
//
//   egress (6b/6c) — an authenticated, long-lived WebSocket "drain": a
//   recipient MUST prove DID ownership (Ed25519-sign a server-issued,
//   single-use nonce with the DID's did:peer:2 signing key) before any
//   queued wire is streamed to them. A signature that doesn't verify
//   against the CLAIMED did's key is rejected outright — the socket is
//   closed, nothing is queued or leaked, and the relay never associates
//   that connection with any DID's queue.
//
// Design note on "forward immediately, else enqueue" (6a's requirement):
// this implementation ALWAYS persists first (queueStore.enqueue), then
// immediately flushes to a live authenticated drain if one exists. Rows
// are removed from the queue store ONLY on an explicit ack from the
// recipient (ackDelivered) — never on drain, never on send. This makes
// 6c's "re-enqueue unacked wires on disconnect" free: a wire pushed to a
// socket that dies before acking was never actually dequeued, so the next
// authenticated drain (reconnect) redelivers it. At-least-once delivery;
// DidCommTransport's message-id dedup (dedup_store.ts / Task 2) absorbs
// any resulting duplicate deliveries on the receiving side.
//
// Servable-recipient policy: `isRoutable` decides whether this relay will
// hold mail for a given DID at all (default: permissive — accepts any
// DID). A relay that restricts this to its known trust-graph friends will
// synchronously reject an unroutable `to` from submit(), so a caller (the
// future RelayChannel / Task 7) can fall back to the next ladder rung
// instead of silently trusting store-and-forward to a relay with nothing
// to route.
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { resolveDidPeer } from "./did_identity.js";
import { InMemoryRelayQueueStore, type RelayQueueStore } from "./relay_queue_store.js";

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function unb64u(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

export type SubmitResult =
  | { routed: "live"; toDid: string; queueId: string }
  | { routed: "queued"; toDid: string; queueId: string }
  | { routed: "rejected"; reason: string };

export interface RelayServerOptions {
  /** Persistence for undelivered wires. Defaults to an in-memory store (lost on restart — pass a SqliteRelayQueueStore for production use). */
  queueStore?: RelayQueueStore;
  /** Does this relay hold/route mail for `toDid`? Default: accept any DID (open relay). */
  isRoutable?: (toDid: string) => boolean;
  /** ws ping interval for detecting a dead authenticated drain connection. */
  heartbeatIntervalMs?: number;
}

/** Per-WebSocket connection state. Never exported — internal bookkeeping only. */
interface ConnState {
  authenticated: boolean;
  did?: string;
  /** Single-use challenge; cleared after the first auth attempt (success or failure) so it can never be replayed. */
  nonce?: string;
  /** Queue ids already pushed on this socket, awaiting ack — avoids resending on every flush() while a delivery is in flight. */
  sentPending: Set<string>;
  isAlive: boolean;
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

/** Shape validated at the JSON layer only; body fields are never trusted before their specific check. */
interface ClientMessage {
  type?: unknown;
  did?: unknown;
  sig?: unknown;
  ids?: unknown;
}

export class RelayServer {
  private readonly queueStore: RelayQueueStore;
  private readonly isRoutableCheck: (toDid: string) => boolean;
  private readonly heartbeatIntervalMs: number;

  /** DID -> its single active authenticated drain socket (a fresh auth for the same DID replaces the prior one). */
  private readonly liveDrains = new Map<string, WebSocket>();
  private readonly connState = new WeakMap<WebSocket, ConnState>();

  private wss?: WebSocketServer;
  private ownedHttpServer?: HttpServer;

  constructor(opts: RelayServerOptions = {}) {
    this.queueStore = opts.queueStore ?? new InMemoryRelayQueueStore();
    this.isRoutableCheck = opts.isRoutable ?? (() => true);
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 30_000;
  }

  // ---- 6a: ingress -------------------------------------------------------

  /**
   * Accept an opaque wire addressed to a DID. Reads ONLY the outer `to`
   * field via a plain JSON.parse of the wire's outer envelope — this is
   * the cleartext routing header didcomm_crypto.ts's EncryptedWire always
   * carries; the ciphertext payload is never touched. Never throws.
   */
  submit(rawWire: string): SubmitResult {
    let to: string;
    try {
      const parsed = JSON.parse(rawWire) as { to?: unknown };
      if (typeof parsed.to !== "string" || parsed.to.length === 0) {
        return { routed: "rejected", reason: "malformed wire: outer 'to' is missing or not a string" };
      }
      to = parsed.to;
    } catch {
      return { routed: "rejected", reason: "malformed wire: not valid JSON" };
    }

    if (!this.isRoutableCheck(to)) {
      return { routed: "rejected", reason: `no route to ${to}` };
    }

    this.queueStore.prune(Date.now());
    const queueId = this.queueStore.enqueue(to, rawWire);

    const live = this.liveDrains.get(to);
    if (live && live.readyState === WebSocket.OPEN) {
      this.flush(to);
      return { routed: "live", toDid: to, queueId };
    }
    return { routed: "queued", toDid: to, queueId };
  }

  /** Push every currently-queued, not-yet-sent-on-this-socket wire for `toDid` if it has a live authenticated drain. Idempotent. */
  private flush(toDid: string): void {
    const ws = this.liveDrains.get(toDid);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const state = this.connState.get(ws);
    if (!state) return;
    this.queueStore.prune(Date.now());
    for (const q of this.queueStore.drain(toDid)) {
      if (state.sentPending.has(q.id)) continue; // already in flight on this socket
      state.sentPending.add(q.id);
      ws.send(JSON.stringify({ type: "wire", id: q.id, wire: q.wire }));
    }
  }

  // ---- 6b/6c: authenticated drain ----------------------------------------

  /**
   * Mount the drain WS endpoint onto an existing http.Server. Additive by
   * construction: `ws`'s `{server, path}` form hooks the HTTP "upgrade"
   * event for the given path only, which never competes with a server's
   * existing "request" listener (this is the same mechanism
   * agent-daemon/src/api/server.ts already uses for its own `/ws` mount).
   * Wiring this into the daemon's own server.ts as an extras.* hook is
   * Task 10's job (see relay_server.ts's file header / t6-report.md); this
   * method is what a future caller (Task 10, or `listen()` below) attaches.
   */
  attachDrainWss(httpServer: HttpServer, path = "/relay/drain"): void {
    const wss = new WebSocketServer({ server: httpServer, path });
    wss.on("connection", (ws) => this.handleConnection(ws));
    this.wss = wss;
  }

  private handleConnection(ws: WebSocket): void {
    const nonce = b64u(randomBytes(24));
    const state: ConnState = { authenticated: false, nonce, sentPending: new Set(), isAlive: true };
    this.connState.set(ws, state);
    ws.send(JSON.stringify({ type: "challenge", nonce }));

    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return; // ignore malformed frames (forward-compat / defensive)
      }
      if (msg.type === "auth") this.handleAuth(ws, state, msg);
      else if (msg.type === "ack") this.handleAck(state, msg);
      // unknown types ignored silently, matching the JWM dispatch convention elsewhere in this package
    });
    ws.on("pong", () => {
      state.isAlive = true;
    });
    ws.on("close", () => this.handleClose(ws, state));
    ws.on("error", () => {
      // "close" always follows "error" for ws sockets; cleanup lives there.
    });
  }

  /**
   * Verify DID ownership: the client must return Ed25519.sign(nonce) using
   * the claimed DID's signing key. A signature that does not verify against
   * resolveDidPeer(did).signingPublicKey is REJECTED — no queue for `did`
   * is ever attached to this socket, so a spoofed claim cannot drain (or
   * even learn whether mail exists for) another peer's queue. The nonce is
   * single-use: cleared here regardless of outcome, so a failed guess
   * cannot be retried on the same challenge.
   */
  private handleAuth(ws: WebSocket, state: ConnState, msg: ClientMessage): void {
    if (state.authenticated) return; // already authenticated on this socket; ignore repeats
    const nonce = state.nonce;
    state.nonce = undefined;

    let verified = false;
    if (nonce && typeof msg.did === "string" && typeof msg.sig === "string") {
      try {
        const resolved = resolveDidPeer(msg.did);
        verified = ed25519.verify(unb64u(msg.sig), unb64u(nonce), resolved.signingPublicKey);
      } catch {
        verified = false; // malformed DID, bad base64, wrong-length signature, etc. — all reject
      }
    }

    if (!verified) {
      ws.send(JSON.stringify({ type: "auth_failed", reason: "signature does not verify for claimed DID" }));
      ws.close();
      return;
    }

    const did = msg.did as string;
    state.authenticated = true;
    state.did = did;
    // One active drain per DID: a fresh, successfully-authenticated connection
    // for the same DID displaces the previous one rather than leaving two
    // sockets racing to drain (and double-deliver) the same queue.
    const prior = this.liveDrains.get(did);
    if (prior && prior !== ws) prior.close();
    this.liveDrains.set(did, ws);

    ws.send(JSON.stringify({ type: "auth_ok" }));
    this.startHeartbeat(ws, state);
    this.flush(did); // 6c: forward-on-connect
  }

  private handleAck(state: ConnState, msg: ClientMessage): void {
    if (!state.authenticated || !state.did || !Array.isArray(msg.ids)) return;
    const ids = msg.ids.filter((x): x is string => typeof x === "string");
    if (ids.length === 0) return;
    this.queueStore.ackDelivered(state.did, ids);
    for (const id of ids) state.sentPending.delete(id);
  }

  /** 6c liveness: ping on an interval, terminate a socket that never pongs back. */
  private startHeartbeat(ws: WebSocket, state: ConnState): void {
    const timer = setInterval(() => {
      if (!state.isAlive) {
        clearInterval(timer);
        ws.terminate();
        return;
      }
      state.isAlive = false;
      ws.ping();
    }, this.heartbeatIntervalMs);
    timer.unref?.(); // never keep a process alive solely for relay heartbeats
    state.heartbeatTimer = timer;
  }

  private handleClose(ws: WebSocket, state: ConnState): void {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if (state.authenticated && state.did && this.liveDrains.get(state.did) === ws) {
      this.liveDrains.delete(state.did);
    }
    // No explicit DB "re-enqueue" call needed here: rows this socket sent
    // but never acked were never removed from queueStore in the first
    // place (see the file header) — dropping state.sentPending is enough.
  }

  // ---- standalone convenience (used by relay_server.test.ts) ------------

  /**
   * Boots this relay as its own dedicated HTTP+WS server: POST {ingressPath}
   * with a raw wire body submits it; the drain WS is mounted at
   * {drainPath}. This is the "one node runs relay_server" deployment shape
   * (core-transport-plan.md Task 10) — a standalone process, not something
   * layered onto an unrelated daemon's request router (see attachDrainWss's
   * doc comment for why HTTP *route* mounting isn't safely additive onto an
   * arbitrary existing server the way the WS mount is).
   */
  async listen(port: number, host = "127.0.0.1", opts?: { ingressPath?: string; drainPath?: string }): Promise<{ port: number }> {
    const ingressPath = opts?.ingressPath ?? "/relay/send";
    const drainPath = opts?.drainPath ?? "/relay/drain";
    const httpServer = createHttpServer((req, res) => {
      void this.handleIngressRequest(req, res, ingressPath).catch((err: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
    });
    this.ownedHttpServer = httpServer;
    this.attachDrainWss(httpServer, drainPath);
    return new Promise((resolve, reject) => {
      httpServer.on("error", reject);
      httpServer.listen(port, host, () => {
        const addr = httpServer.address();
        resolve({ port: typeof addr === "object" && addr ? addr.port : port });
      });
    });
  }

  private async handleIngressRequest(req: IncomingMessage, res: ServerResponse, ingressPath: string): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "POST" || url.pathname !== ingressPath) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `not found: ${req.method ?? ""} ${url.pathname}` }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const rawWire = Buffer.concat(chunks).toString("utf8");

    const result = this.submit(rawWire);
    if (result.routed === "rejected") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  }

  async close(): Promise<void> {
    for (const ws of this.liveDrains.values()) ws.terminate();
    this.liveDrains.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }
      this.wss.close(() => resolve());
    });
    if (this.ownedHttpServer) {
      const server = this.ownedHttpServer;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}
