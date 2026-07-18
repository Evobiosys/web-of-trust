// REST + WS server — implements docs/API.md exactly (paths, shapes, event
// names). Plain node:http + ws (brief: "keep deps lean"). Binds 127.0.0.1
// only, per the contract.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Daemon } from "../daemon/daemon.js";

export interface StartedServer {
  close(): Promise<void>;
  port: number;
}

/**
 * Optional, additive server capabilities wired from main.ts so daemon.ts stays
 * untouched (other agents own its internals). Both are absent for mock/matrix.
 */
export interface ServerExtras {
  /** Handles an inbound encrypted DIDComm message body (mounted at POST /didcomm). Throws on reject. */
  didcommInbound?: (rawBody: string) => Promise<void>;
  /** Returns this daemon's signed VRCs (served at GET /api/trust/export?format=vrc). */
  trustExport?: () => unknown[];
}

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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

/** WS event payload shapes, per docs/API.md's WS section. */
type WsEvent =
  | { type: "state_changed" }
  | { type: "steward_reply"; text: string }
  | { type: "consent_card"; card_id: string }
  | { type: "ask_update"; request_id: string; state: string }
  | { type: "room_message"; room_id: string; from: string; text: string; ts: string };

export function startServer(daemon: Daemon, port: number, extras: ServerExtras = {}): Promise<StartedServer> {
  const sockets = new Set<WebSocket>();

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
        sendJson(res, 400, { error: "text is required" });
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
        sendJson(res, 400, { error: "card_id is required" });
        return;
      }
      await daemon.consent(body.card_id, body.conditions);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && path === "/api/decline") {
      const body = (await readJsonBody(req)) as { card_id?: string };
      if (typeof body.card_id !== "string") {
        sendJson(res, 400, { error: "card_id is required" });
        return;
      }
      await daemon.decline(body.card_id);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && path === "/api/withdraw") {
      const body = (await readJsonBody(req)) as { request_id?: string; reason?: "fulfilled" | "cancelled" };
      if (typeof body.request_id !== "string") {
        sendJson(res, 400, { error: "request_id is required" });
        return;
      }
      await daemon.withdraw(body.request_id, body.reason ?? "cancelled");
      sendJson(res, 200, { ok: true });
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
        sendJson(res, 400, { error: "only format=vrc is supported" });
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
        sendJson(res, 400, { error: "text is required" });
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
    httpServer.listen(port, "127.0.0.1", () => {
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
