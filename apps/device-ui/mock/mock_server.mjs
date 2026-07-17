#!/usr/bin/env node
// Mock agent-daemon implementing docs/API.md exactly (REST + WS) for
// device-ui development and the standalone demo. Not shipped in the app
// build — dev/test tooling only. Real daemon integration happens at merge
// (see CLAUDE.md / task-m3u-brief.md).
//
// Usage: node mock/mock_server.mjs --persona=anna --port=4101 --scene=0

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { getScene, SCENE_LABELS } from "./scenes.mjs";

function parseArgs(argv) {
  const out = { persona: "anna", port: 4101, scene: 0 };
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "persona") out.persona = value;
    else if (key === "port") out.port = Number(value);
    else if (key === "scene") out.scene = Number(value);
  }
  return out;
}

const { persona, port, scene } = parseArgs(process.argv.slice(2));

let state = getScene(persona, scene);
let pendingCapture = null; // { labels, description } awaiting yes/ja confirmation
const auditEntries = [];

function audit(decision, detail) {
  auditEntries.push({ ts: new Date().toISOString(), decision, detail });
}

function nowIso() {
  return new Date().toISOString();
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const wsClients = new Set();

function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const socket of wsClients) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

function broadcastStateChanged() {
  broadcast({ type: "state_changed" });
}

// --- steward intent handling (heuristic, mock-only — real classification
// lives in the daemon per docs/API.md § POST /api/steward) -------------

const ASK_HINT = /\?|hat (wer|jemand)|does anyone|is there/i;
const CAPTURE_HINT = /^i have\b|^ich habe\b/i;
const CONFIRM_HINT = /^(yes|ja|ok)\.?$/i;

function handleSteward(text) {
  const trimmed = text.trim();
  state.steward_log.push({ role: "user", text: trimmed, ts: nowIso() });

  let reply;
  if (pendingCapture && CONFIRM_HINT.test(trimmed)) {
    state.items.push({
      id: `item-${randomUUID()}`,
      labels: pendingCapture.labels,
      description: pendingCapture.description,
      tags: [],
      provenance: { kind: "self" },
      policy: { audience: "trusted", mode: "ask_each_time", expires_at: yearFromNow() },
      availability: undefined,
    });
    pendingCapture = null;
    reply = "Saved to your inventory.";
    audit("inventory_captured", trimmed);
  } else if (CAPTURE_HINT.test(trimmed)) {
    const description = trimmed.replace(/^i have\b/i, "").replace(/^ich habe\b/i, "").trim();
    pendingCapture = { labels: [description || "new item"], description: description || trimmed };
    reply = `Got it — "${pendingCapture.labels[0]}". Shared with trusted peers, ask-each-time. Save it? (yes/ja)`;
  } else if (ASK_HINT.test(trimmed)) {
    const requestId = `req-${randomUUID()}`;
    const queriedCount = Math.max(1, state.trust_edges.length);
    state.asks.push({
      request_id: requestId,
      text: trimmed,
      created_at: nowIso(),
      state: "waiting",
      queried_count: queriedCount,
    });
    reply = `Asked ${queriedCount} trusted people nearby. You'll hear back.`;
    audit("request_sent", trimmed);
  } else {
    reply = "Noted — I'll keep an eye out.";
  }

  state.steward_log.push({ role: "agent", text: reply, ts: nowIso() });
  return reply;
}

function yearFromNow() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}

function handleConsent(cardId, conditions) {
  const card = state.consent_cards.find((c) => c.card_id === cardId);
  if (!card) return false;
  card.state = "consented";
  const roomId = `room-${randomUUID()}`;
  state.rooms.push({
    room_id: roomId,
    peers: [
      { peer_id: card.requester.peer_id, display: card.requester.display },
      { peer_id: state.persona.peer_id, display: state.persona.name },
    ],
    messages: conditions
      ? [{ from: state.persona.name, text: `Sure — ${conditions}`, ts: nowIso() }]
      : [],
    context: card.matched_item.labels[0] ?? card.text,
  });
  audit("consented", conditions ? `card ${cardId} (conditions: ${conditions})` : `card ${cardId}`);
  return true;
}

function handleDecline(cardId) {
  const card = state.consent_cards.find((c) => c.card_id === cardId);
  if (!card) return false;
  // I3: this is wire-indistinguishable from a no-match from the asker's
  // point of view; the owner's own local record may say "declined".
  card.state = "declined";
  audit("declined", `card ${cardId}`); // local-only, never wire-transmitted
  return true;
}

function handleWithdraw(requestId, reason) {
  let found = false;
  for (const ask of state.asks) {
    if (ask.request_id === requestId) {
      ask.state = "withdrawn";
      found = true;
    }
  }
  for (const card of state.consent_cards) {
    if (card.request_id === requestId) {
      card.state = "inactive";
      found = true;
    }
  }
  if (found) audit("withdrawn", `request ${requestId} (${reason ?? "no reason given"})`);
  return found;
}

function handleRoomMessage(roomId, text) {
  const room = state.rooms.find((r) => r.room_id === roomId);
  if (!room) return false;
  const message = { from: state.persona.name, text, ts: nowIso() };
  room.messages.push(message);
  broadcast({ type: "room_message", room_id: roomId, ...message });
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      sendJson(res, 200, { entries: auditEntries });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/steward") {
      const body = await readBody(req);
      if (typeof body.text !== "string" || !body.text.trim()) {
        sendJson(res, 400, { error: "text is required" });
        return;
      }
      const reply = handleSteward(body.text);
      sendJson(res, 200, { reply });
      broadcast({ type: "steward_reply", text: reply });
      broadcastStateChanged();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/consent") {
      const body = await readBody(req);
      if (typeof body.card_id !== "string") {
        sendJson(res, 400, { error: "card_id is required" });
        return;
      }
      const ok = handleConsent(body.card_id, body.conditions);
      if (!ok) {
        sendJson(res, 404, { error: "card not found" });
        return;
      }
      sendJson(res, 200, { ok: true });
      broadcastStateChanged();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/decline") {
      const body = await readBody(req);
      if (typeof body.card_id !== "string") {
        sendJson(res, 400, { error: "card_id is required" });
        return;
      }
      const ok = handleDecline(body.card_id);
      if (!ok) {
        sendJson(res, 404, { error: "card not found" });
        return;
      }
      sendJson(res, 200, { ok: true });
      broadcastStateChanged();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/withdraw") {
      const body = await readBody(req);
      if (typeof body.request_id !== "string") {
        sendJson(res, 400, { error: "request_id is required" });
        return;
      }
      const ok = handleWithdraw(body.request_id, body.reason);
      if (!ok) {
        sendJson(res, 404, { error: "request not found" });
        return;
      }
      sendJson(res, 200, { ok: true });
      broadcastStateChanged();
      return;
    }

    const roomMatch = /^\/api\/rooms\/([^/]+)\/message$/.exec(url.pathname);
    if (req.method === "POST" && roomMatch) {
      const body = await readBody(req);
      if (typeof body.text !== "string" || !body.text.trim()) {
        sendJson(res, 400, { error: "text is required" });
        return;
      }
      const ok = handleRoomMessage(decodeURIComponent(roomMatch[1]), body.text);
      if (!ok) {
        sendJson(res, 404, { error: "room not found" });
        return;
      }
      sendJson(res, 200, { ok: true });
      broadcastStateChanged();
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : "bad request" });
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (socket) => {
  wsClients.add(socket);
  socket.on("close", () => wsClients.delete(socket));
});

server.listen(port, "127.0.0.1", () => {
  const label = SCENE_LABELS[scene] ?? `scene-${scene}`;
  // eslint-disable-next-line no-console
  console.log(
    `[mock-agent] persona=${persona} scene=${scene} (${label}) listening on http://127.0.0.1:${port} (ws at /ws)`,
  );
});
