// @ts-check
// QR-onboarding Task 6: the self-sovereign guest's LIVE chat with the origin.
//
// A device that scanned an origin's QR, minted its own keys, and was ACCEPTED
// (connect_flow.js) holds a real, mutual trust edge to that origin — but it is
// DAEMONLESS: no `/api/state`, no persona store, no fixture floor of its own.
// Its real, honest state is exactly two things: "connected to <origin>" and a
// two-person thread with them. This module renders that thread and drives it
// over the browser RelayClient connect_flow already opened:
//   send()      — build a DM envelope, relayClient.send(originDid, env).
//   onInbound() — an inbound DM from the origin appends a `them` bubble.
//
// PERSISTENCE: the guest has no daemon to store the conversation, so the whole
// thread lives in localStorage (per-origin key), degrading to a module-lifetime
// in-memory map where `window.localStorage` throws (mirrors connect_flow.js /
// runtime_config.js). A reload re-reads it and re-renders the conversation.
//
// SINGLE RENDER SOURCE: both send and receive append to the persisted history
// then re-render the bubble list FROM that history — never a manual node append
// alongside a re-render (that double-renders). The bubble text off the wire is
// untrusted, so it is HTML-escaped at render time.

import { $ } from "../dom.js";
import { ctx } from "../context.js";

/** Per-origin localStorage key prefix for the persisted DM thread. */
const THREAD_PREFIX = "resource-web.connect.thread.";

// --- storage with in-memory fallback (see file header) -----------------------
/** @type {Map<string, string> | undefined} */
let memoryFallback;

/** @returns {Map<string, string>} */
function fallbackStore() {
  if (!memoryFallback) memoryFallback = new Map();
  return memoryFallback;
}

/** @param {string} key @returns {string | undefined} */
function readStore(key) {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? undefined : v;
  } catch {
    return fallbackStore().get(key);
  }
}

/** @param {string} key @param {string} value */
function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    fallbackStore().set(key, value);
  }
}

/** @param {string} key */
function removeStore(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* fall through to the in-memory fallback below */
  }
  fallbackStore().delete(key);
}

/** @param {string} originDid @returns {string} */
function threadKey(originDid) {
  return THREAD_PREFIX + originDid;
}

// --- small helpers -----------------------------------------------------------
/** HTML-escape untrusted wire text before it reaches innerHTML.
 * @param {string} s @returns {string} */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** RFC-4122 v4 uuid — native `crypto.randomUUID` where available, with a tiny
 * fallback so every DM's `request_id` is a valid uuid (the origin daemon parses
 * the envelope against a `.strict()` schema whose `request_id` MUST be a uuid;
 * a bad one is dropped silently, never surfaced).
 * @returns {string} */
function newUuid() {
  const c = /** @type {any} */ (globalThis).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// --- persisted history -------------------------------------------------------
/** One stored line: ["me"|"them", rawText]. Text is stored RAW and escaped only
 * at render — never store pre-escaped HTML.
 * @typedef {["me" | "them", string]} ThreadLine */

/** @param {string} originDid @returns {ThreadLine[]} */
function loadHistory(originDid) {
  const raw = readStore(threadKey(originDid));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? /** @type {ThreadLine[]} */ (arr) : [];
  } catch {
    return [];
  }
}

/** @param {string} originDid @param {ThreadLine[]} history */
function saveHistory(originDid, history) {
  writeStore(threadKey(originDid), JSON.stringify(history));
}

/** Append one line and persist. Returns nothing — callers re-render from
 * history so there is a single source of truth.
 * @param {string} originDid @param {"me" | "them"} who @param {string} text */
function appendMessage(originDid, who, text) {
  const history = loadHistory(originDid);
  history.push([who, text]);
  saveHistory(originDid, history);
}

// --- module-live connection --------------------------------------------------
/** @type {{ send: (toDid: string, env: unknown) => unknown, onInbound: (cb: (fromDid: string, env: unknown) => void) => void, start: () => Promise<void>, stop: () => void } | null} */
let liveClient = null;
/** @type {{ originDid: string, originDisplay: string, myDisplay: string } | null} */
let live = null;

/** Re-render the bubble list FROM persisted history (single source of truth).
 * No-op when the guest-chat screen markup isn't mounted. */
function renderBubbles() {
  const el = $("guestBubs");
  if (!el || !live) return;
  el.innerHTML = loadHistory(live.originDid)
    .map(([who, text]) => '<div class="bub ' + (who === "me" ? "me" : "them") + '">' + escapeHtml(text) + "</div>")
    .join("");
  el.scrollTop = el.scrollHeight;
}

/** Wire the composer: Send on the button tap (reliable on mobile — on-screen
 * keyboards don't always fire an Enter keydown) OR the Enter key. Build a DM
 * envelope, hand it to the relay client, optimistically append + persist, then
 * re-render from history. The send promise is `.catch()`-guarded so a relay
 * rejection can't become an unhandled rejection — the optimistic bubble stays. */
function wireComposer() {
  const input = /** @type {HTMLInputElement} */ ($("guestDmInput"));
  const btn = $("guestDmSend");
  if (!input || !btn) return;
  const send = () => {
    const text = input.value.trim();
    if (!text || !liveClient || !live) return;
    const env = { v: "0.1", type: "DM", request_id: newUuid(), ts: new Date().toISOString(), body: { text } };
    Promise.resolve(liveClient.send(live.originDid, env)).catch(() => {
      /* relay unreachable/rejected — keep the optimistic bubble; a browser peer
         has no other route and re-sending is the human's call. */
    });
    appendMessage(live.originDid, "me", text);
    input.value = "";
    renderBubbles();
    input.focus();
  };
  btn.onclick = send;
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };
}

/** Reveal the guest-chat screen for the current live connection: title it with
 * the origin's display, load + render the persisted thread, wire the composer. */
export function openGuestChat() {
  if (!live) return;
  const title = $("guestChatTitle");
  if (title) title.textContent = live.originDisplay;
  const intro = $("guestChatIntro");
  if (intro) {
    intro.textContent =
      "You’re connected to " + live.originDisplay + " — a private thread carried by your own keys, just the two of you.";
  }
  const input = /** @type {HTMLInputElement} */ ($("guestDmInput"));
  if (input) input.setAttribute("placeholder", "Message " + live.originDisplay + "…");
  wireComposer();
  renderBubbles();
  ctx.show("guestchat");
}

/**
 * Hold the relay client for the session, wire inbound DM handling, and reveal
 * the chat. The CALLER owns `start()` — on the fresh-connect path the client is
 * already started by connect_flow; on the reload path the caller must register
 * (this) BEFORE start() so at-least-once redelivery of DMs sent while the guest
 * was away is captured, not acked-and-lost.
 *
 * @param {Object} args
 * @param {{ send: (toDid: string, env: unknown) => unknown, onInbound: (cb: (fromDid: string, env: unknown) => void) => void, start: () => Promise<void>, stop: () => void }} args.client
 * @param {string} args.originDid
 * @param {string} args.originDisplay
 * @param {string} args.myDisplay
 */
export function beginGuestChat({ client, originDid, originDisplay, myDisplay }) {
  liveClient = client;
  live = { originDid, originDisplay, myDisplay };
  client.onInbound((fromDid, envelope) => {
    const e = /** @type {any} */ (envelope);
    // Only a DM from the ORIGIN lands in this thread: a non-DM envelope, or a
    // DM from any other DID, is ignored (never a bubble).
    if (fromDid === originDid && e && e.type === "DM" && e.body && typeof e.body.text === "string") {
      appendMessage(originDid, "them", e.body.text);
      renderBubbles(); // live update when the screen is open; harmless otherwise
    }
  });
  openGuestChat();
}

/** Test-only: drop the module-live connection and (optionally) a persisted
 * thread, so cases don't leak state through module scope.
 * @param {string} [originDid] */
export function __resetGuestChatForTests(originDid) {
  liveClient = null;
  live = null;
  if (originDid) removeStore(threadKey(originDid));
}
