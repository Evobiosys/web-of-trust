// REST + WS server — implements docs/API.md exactly (paths, shapes, event
// names). Plain node:http + ws (brief: "keep deps lean"). Binds 127.0.0.1 by
// default; LAN exposure is opt-in via API_HOST (Task 5), never the default.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { TrustLevel } from "@resource-web/protocol";
import type { Daemon } from "../daemon/daemon.js";
import { buildGuestListings, buildListingApiView, buildLoanApiView, buildReceivedListingApiView, buildThreadMessageApiView } from "./sanitize.js";

export interface StartedServer {
  close(): Promise<void>;
  port: number;
}

/**
 * Optional, additive server capabilities wired from main.ts so daemon.ts stays
 * untouched (other agents own its internals). All are absent for mock/matrix.
 */
export interface ServerExtras {
  /** Handles an inbound encrypted DIDComm message body (mounted at POST /didcomm). Throws on reject. */
  didcommInbound?: (rawBody: string) => Promise<void>;
  /** Returns this daemon's signed VRCs (served at GET /api/trust/export?format=vrc). */
  trustExport?: () => unknown[];
  /**
   * Bind host (Task 5). Defaults to `process.env.API_HOST ?? "127.0.0.1"`
   * inside `startServer` when omitted — kept in this options bag (rather
   * than a new positional parameter) so the existing 2-arg test call and
   * 3-arg main.ts call both keep working unchanged; a literal 3rd positional
   * `host` parameter would collide with `didcommInbound`/`trustExport`,
   * which main.ts already passes there.
   */
  host?: string;
  /**
   * DID card fields (Task 11's `getCardPayload`), merged into GET /api/card
   * when TRANSPORT=didcomm. Absent for mock/matrix — /api/card still works,
   * just without `did`/`endpoint`.
   */
  cardExtra?: { did: string; endpoint: string };
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
};

async function readTextBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readTextBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
}

/** Every response (success, 4xx, or the top-level 500 catch) goes through this — CORS is unconditional (brief). */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function badRequest(res: ServerResponse, error: string): void {
  sendJson(res, 400, { error });
}

/** WS event payload shapes, per docs/API.md's WS section. */
type WsEvent =
  | { type: "state_changed" }
  | { type: "steward_reply"; text: string }
  | { type: "consent_card"; card_id: string }
  | { type: "ask_update"; request_id: string; state: string }
  | { type: "room_message"; room_id: string; from: string; text: string; ts: string }
  | { type: "listing"; listing_id: string }
  | { type: "loan"; loan_id: string }
  | { type: "dm"; peer_id: string };

const LOAN_STATES = new Set(["approved", "declined", "lent", "returned", "complete", "not_yet"]);
const TRUST_LEVELS = new Set<TrustLevel>(["contact", "friend", "close"]);

export function startServer(daemon: Daemon, port: number, extras: ServerExtras = {}): Promise<StartedServer> {
  const sockets = new Set<WebSocket>();
  const host = extras.host ?? process.env.API_HOST ?? "127.0.0.1";

  function broadcast(event: WsEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  const httpServer = createServer((req, res) => {
    void handleRequest(req, res).catch((err: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message });
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";
    const path = url.pathname;

    // CORS preflight — every route accepts it, no auth/route matching needed.
    if (method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (method === "GET" && path === "/api/state") {
      sendJson(res, 200, daemon.getStateSnapshot());
      return;
    }

    if (method === "GET" && path === "/api/audit") {
      sendJson(res, 200, { entries: daemon.getAudit() });
      return;
    }

    if (method === "POST" && path === "/api/steward") {
      const body = (await readJsonBody(req)) as { text?: string };
      if (typeof body.text !== "string" || body.text.length === 0) {
        badRequest(res, "text is required");
        return;
      }
      const reply = await daemon.handleSteward(body.text);
      broadcast({ type: "steward_reply", text: reply });
      sendJson(res, 200, { reply });
      return;
    }

    if (method === "POST" && path === "/api/consent") {
      const body = (await readJsonBody(req)) as { card_id?: string; conditions?: string };
      if (typeof body.card_id !== "string") {
        badRequest(res, "card_id is required");
        return;
      }
      await daemon.consent(body.card_id, body.conditions);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && path === "/api/decline") {
      const body = (await readJsonBody(req)) as { card_id?: string };
      if (typeof body.card_id !== "string") {
        badRequest(res, "card_id is required");
        return;
      }
      await daemon.decline(body.card_id);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && path === "/api/withdraw") {
      const body = (await readJsonBody(req)) as { request_id?: string; reason?: "fulfilled" | "cancelled" };
      if (typeof body.request_id !== "string") {
        badRequest(res, "request_id is required");
        return;
      }
      await daemon.withdraw(body.request_id, body.reason ?? "cancelled");
      sendJson(res, 200, { ok: true });
      return;
    }

    // ------------------------------------------------- Task 5: trust mgmt --

    if (method === "GET" && path === "/api/trust") {
      sendJson(res, 200, { trust_edges: daemon.getStateSnapshot().trust_edges });
      return;
    }

    if (method === "POST" && path === "/api/trust") {
      const body = (await readJsonBody(req)) as { peer?: string; display?: string; level?: string; vouched_by?: string };
      if (typeof body.peer !== "string" || body.peer.length === 0) {
        badRequest(res, "peer is required");
        return;
      }
      if (typeof body.display !== "string" || body.display.length === 0) {
        badRequest(res, "display is required");
        return;
      }
      if (body.level !== undefined && !TRUST_LEVELS.has(body.level as TrustLevel)) {
        badRequest(res, `level must be one of ${[...TRUST_LEVELS].join(", ")}`);
        return;
      }
      try {
        const edge = await daemon.addTrust({ peer: body.peer, display: body.display, level: body.level as TrustLevel | undefined, vouched_by: body.vouched_by });
        sendJson(res, 200, { trust_edge: edge });
      } catch (err) {
        badRequest(res, (err as Error).message);
      }
      return;
    }

    if (method === "DELETE" && path === "/api/trust") {
      const bodyPeer = ((await readJsonBody(req)) as { peer?: string }).peer;
      const peer = url.searchParams.get("peer") ?? bodyPeer;
      if (typeof peer !== "string" || peer.length === 0) {
        badRequest(res, "peer is required (query param or JSON body)");
        return;
      }
      daemon.removeTrust(peer);
      sendJson(res, 200, { ok: true });
      return;
    }

    // ----------------------------------------------------- Task 5: notes --

    if (method === "POST" && path === "/api/notes") {
      const body = (await readJsonBody(req)) as {
        labels?: string[];
        description?: string;
        tags?: string[];
        owner?: string;
        location_area?: string;
        availability?: string;
      };
      if (!Array.isArray(body.labels) || body.labels.length === 0) {
        badRequest(res, "labels is required (non-empty array)");
        return;
      }
      if (typeof body.description !== "string" || body.description.length === 0) {
        badRequest(res, "description is required");
        return;
      }
      if (typeof body.owner !== "string" || body.owner.length === 0) {
        badRequest(res, "owner is required (the noted person's peer id)");
        return;
      }
      try {
        // D1.6 / I8: no notification is sent here — the noted owner is only
        // pinged at first relay attempt (daemon/listings.ts's forwardRelay).
        const item = daemon.addNote({
          labels: body.labels,
          description: body.description,
          tags: body.tags,
          owner: body.owner,
          location_area: body.location_area,
          availability: body.availability,
        });
        sendJson(res, 200, { item_id: item.id });
      } catch (err) {
        badRequest(res, (err as Error).message);
      }
      return;
    }

    // -------------------------------------------------- Task 5: listings --

    if (method === "GET" && path === "/api/listings") {
      if (url.searchParams.get("public") === "1") {
        // Guest/unauthenticated view — SECURITY-CRITICAL: public-tier only,
        // where_gated stripped. See sanitize.ts's buildGuestListings.
        sendJson(res, 200, { mine: buildGuestListings(daemon.getStore()), received: [] });
        return;
      }
      const snapshot = daemon.getStateSnapshot();
      sendJson(res, 200, { mine: snapshot.listings_mine, received: snapshot.listings_received });
      return;
    }

    if (method === "POST" && path === "/api/listings") {
      const body = (await readJsonBody(req)) as {
        kind?: "offer" | "gathering";
        title?: string;
        description?: string;
        when?: string;
        where_public?: string;
        where_gated?: string;
        tier?: "private" | "close" | "trusted" | "wot_commons" | "public";
        steps?: 1 | 2 | 3;
      };
      if (body.kind !== "offer" && body.kind !== "gathering") {
        badRequest(res, 'kind must be "offer" or "gathering"');
        return;
      }
      if (typeof body.title !== "string" || body.title.length === 0) {
        badRequest(res, "title is required");
        return;
      }
      if (typeof body.description !== "string" || body.description.length === 0) {
        badRequest(res, "description is required");
        return;
      }
      if (typeof body.tier !== "string") {
        badRequest(res, "tier is required");
        return;
      }
      try {
        const record = await daemon.publishListing({
          kind: body.kind,
          title: body.title,
          description: body.description,
          when: body.when,
          where_public: body.where_public,
          where_gated: body.where_gated,
          tier: body.tier,
          steps: body.steps,
        });
        broadcast({ type: "listing", listing_id: record.listing_id });
        sendJson(res, 200, { listing_id: record.listing_id });
      } catch (err) {
        badRequest(res, (err as Error).message);
      }
      return;
    }

    const listingWithdrawMatch = /^\/api\/listings\/([^/]+)\/withdraw$/.exec(path);
    if (method === "POST" && listingWithdrawMatch) {
      const listingId = decodeURIComponent(listingWithdrawMatch[1]);
      try {
        await daemon.withdrawListing(listingId);
        broadcast({ type: "listing", listing_id: listingId });
        sendJson(res, 200, { ok: true });
      } catch (err) {
        badRequest(res, (err as Error).message);
      }
      return;
    }

    // ----------------------------------------------------- Task 5: loans --

    if (method === "POST" && path === "/api/borrow") {
      const body = (await readJsonBody(req)) as { listing_id?: string; note?: string };
      if (typeof body.listing_id !== "string" || body.listing_id.length === 0) {
        badRequest(res, "listing_id is required");
        return;
      }
      try {
        const loan = await daemon.requestBorrow(body.listing_id, body.note);
        broadcast({ type: "loan", loan_id: loan.loan_id });
        sendJson(res, 200, { loan_id: loan.loan_id });
      } catch (err) {
        badRequest(res, (err as Error).message);
      }
      return;
    }

    const loanActionMatch = /^\/api\/loans\/([^/]+)$/.exec(path);
    if (method === "POST" && loanActionMatch) {
      const loanId = decodeURIComponent(loanActionMatch[1]);
      const body = (await readJsonBody(req)) as { state?: string; note?: string };
      if (typeof body.state !== "string" || !LOAN_STATES.has(body.state)) {
        badRequest(res, `state must be one of ${[...LOAN_STATES].join(", ")}`);
        return;
      }
      try {
        switch (body.state) {
          case "approved":
            await daemon.approveLoan(loanId);
            break;
          case "declined":
            await daemon.declineLoan(loanId);
            break;
          case "lent":
            await daemon.markLent(loanId);
            break;
          case "returned":
            await daemon.markReturned(loanId);
            break;
          case "complete":
          case "not_yet":
            // `note` here is the local-only completion detail (mockup
            // RES-5) — checkInLoanCompletion never places it on the wire.
            await daemon.checkInLoanCompletion(loanId, body.state, body.note);
            break;
        }
        broadcast({ type: "loan", loan_id: loanId });
        sendJson(res, 200, { ok: true });
      } catch (err) {
        badRequest(res, (err as Error).message);
      }
      return;
    }

    // --------------------------------------------------- Task 5: threads --

    if (method === "GET" && path === "/api/threads") {
      const store = daemon.getStore();
      const threads = store.getDmPeers().map((peer) => buildThreadMessageApiView(store, peer));
      sendJson(res, 200, { threads });
      return;
    }

    const threadMessageMatch = /^\/api\/threads\/([^/]+)\/message$/.exec(path);
    if (method === "POST" && threadMessageMatch) {
      const peerId = decodeURIComponent(threadMessageMatch[1]);
      const body = (await readJsonBody(req)) as { text?: string };
      if (typeof body.text !== "string" || body.text.length === 0) {
        badRequest(res, "text is required");
        return;
      }
      try {
        await daemon.sendDm(peerId, body.text);
        broadcast({ type: "dm", peer_id: peerId });
        sendJson(res, 200, { ok: true });
      } catch (err) {
        badRequest(res, (err as Error).message);
      }
      return;
    }

    // ------------------------------------------------------ Task 5: card --

    if (method === "GET" && path === "/api/card") {
      const { peer_id, name } = daemon.getStateSnapshot().persona;
      sendJson(res, 200, {
        peer_id,
        display: name,
        // I9 conservative default — the level a fresh meet-card offers by
        // default; not persisted anywhere else, purely a UI hint.
        level_offer_default: "friend",
        ...(extras.cardExtra ?? {}),
      });
      return;
    }

    // OpenVTC pillar (Task 11): inbound encrypted DIDComm messages. The
    // transport decrypts/verifies and dispatches to the daemon; a reject
    // (bad signature, replay, wrong recipient) surfaces as 400. Returns 202
    // without awaiting the daemon's downstream cascade.
    if (method === "POST" && path === "/didcomm") {
      if (!extras.didcommInbound) {
        sendJson(res, 404, { error: "didcomm transport not enabled" });
        return;
      }
      const rawBody = await readTextBody(req);
      try {
        await extras.didcommInbound(rawBody);
      } catch (err) {
        sendJson(res, 400, { error: `rejected: ${(err as Error).message}` });
        return;
      }
      sendJson(res, 202, { ok: true });
      return;
    }

    // GET /api/trust/export?format=vrc — this daemon's signed VRCs.
    if (method === "GET" && path === "/api/trust/export") {
      if (url.searchParams.get("format") !== "vrc") {
        badRequest(res, "only format=vrc is supported");
        return;
      }
      if (!extras.trustExport) {
        sendJson(res, 404, { error: "VRC export not available for this transport" });
        return;
      }
      sendJson(res, 200, { credentials: extras.trustExport() });
      return;
    }

    const roomMessageMatch = /^\/api\/rooms\/([^/]+)\/message$/.exec(path);
    if (method === "POST" && roomMessageMatch) {
      const roomId = decodeURIComponent(roomMessageMatch[1]);
      const body = (await readJsonBody(req)) as { text?: string };
      if (typeof body.text !== "string" || body.text.length === 0) {
        badRequest(res, "text is required");
        return;
      }
      await daemon.postRoomMessage(roomId, body.text);
      broadcast({ type: "room_message", room_id: roomId, from: "self", text: body.text, ts: new Date().toISOString() });
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: `not found: ${method} ${path}` });
  }

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
  });

  return new Promise((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(port, host, () => {
      // Every mutation notifies via this hook; state_changed is the only
      // event the UI strictly needs (docs/API.md), so it's always sent.
      daemon.setOnChange(() => broadcast({ type: "state_changed" }));
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            wss.close(() => {
              httpServer.close(() => res());
            });
            for (const ws of sockets) ws.terminate();
          }),
      });
    });
  });
}
