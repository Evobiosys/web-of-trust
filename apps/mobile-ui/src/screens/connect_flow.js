// @ts-check
// QR-onboarding Task 5: the self-sovereign connect flow. A brand-new device
// that scanned an origin's QR opens `<origin>/?connect=<origin DID>&relay=<mediator base>`.
// With NO persona, it lands HERE (see main.js's boot branch): the device
// GENERATES its own DID/keys in-browser (loadOrCreateIdentity, IndexedDB-
// persisted), asks the human their name, opens a RelayClient to the SHARED
// trust-graph mediator (`relay`), sends a CONNECT envelope to the origin DID,
// waits for the origin owner's decision, and — on CONNECT_ACK{accepted:true} —
// enters the app as a brand-new self-sovereign profile connected to the origin.
//
// TOPOLOGY (verified, see qr-task-5-report.md): the browser peer has no HTTP
// endpoint of its own, so it can only reach the origin via the ONE mediator
// every daemon drains. `relay` is that mediator's base ORIGIN; the RelayClient
// appends `/relay/send` + `/relay/drain` exactly like the daemon's
// RelayChannel. The browser's own DID advertises `relay` as its service
// endpoint too, so the origin's CONNECT_ACK (sent via its RelayChannel →
// mediator) routes back to the same mediator this client drains.
//
// SCOPE LINE (this task): "entering" = identity created + CONNECT sent +
// CONNECT_ACK{accepted:true} received + the app entered as this new profile,
// with a "connected to <origin>" indicator. This browser peer has NO daemon,
// so its app-state (Discover/Chat/…) is the thin fixture floor (finishOnb).
// DM-over-relay rendered IN the UI is the next step — the RelayClient is
// returned open so a follow-up can wire send/receive without re-handshaking.

import { $ } from "../dom.js";
import { state } from "../store.js";
import { finishOnb, guestMode } from "./onboarding.js";
import { showCoach } from "../coach.js";
import { onboardingHeading } from "../skin.js";
import { clearConnectConfig } from "../runtime_config.js";

/** localStorage keys for the ESTABLISHED connection record (distinct from
 * runtime_config's in-flight `connect`/`relay` intent): once an origin has
 * accepted, this record is what boot checks FIRST so a bare reload re-enters
 * the connected app directly — never re-sending a CONNECT. */
const CONNECTED_KEYS = {
  originDid: "resource-web.connect.origin_did",
  originDisplay: "resource-web.connect.origin_display",
  myDisplay: "resource-web.connect.my_display",
};

// Some environments expose `window.localStorage` but throw or lack it
// entirely (Safari private mode, disabled by policy, or this repo's Node test
// runner whose experimental global shadows jsdom's). Mirror runtime_config.js:
// degrade to a module-lifetime in-memory store rather than crash. Only
// cross-reload continuity is lost in that case — the in-session flow still
// works end to end.
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

/** Test-only: drop the established-connection record from both real storage
 * (if present) and the in-memory fallback, so cases don't leak state through
 * the module-scoped fallback. */
export function __clearConnectStorageForTests() {
  for (const key of Object.values(CONNECTED_KEYS)) {
    try { window.localStorage.removeItem(key); } catch { /* fall through */ }
    fallbackStore().delete(key);
  }
}

/** @param {string} s @returns {string} */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A friendly short form of a long did:peer string for human-facing copy.
 * @param {string} did @returns {string} */
function shortDid(did) {
  const s = String(did || "");
  return s.length > 22 ? s.slice(0, 16) + "…" + s.slice(-4) : s;
}

/** RFC-4122 v4 uuid — native `crypto.randomUUID` where available (browser
 * secure context + Node ≥19), with a tiny fallback so the CONNECT's
 * `request_id` is always a valid uuid (the daemon parses the envelope against a
 * `.strict()` schema whose `request_id` MUST be a uuid — a bad one is dropped
 * silently, never surfaced). */
function newUuid() {
  const c = /** @type {any} */ (globalThis).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * The client-built CONNECT envelope. Shape is byte-for-byte the daemon's own
 * `connectEnvelope` (packages/agent-daemon/src/daemon/envelopes.ts) — strict:
 * exactly `{v, type, request_id, ts, body:{display, relay}}`, no extra keys, so
 * it validates against protocol's `.strict()` ConnectEnvelopeSchema on receipt.
 * @param {string} requestId @param {string} display @param {string} relay
 */
function connectEnvelope(requestId, display, relay) {
  return {
    v: "0.1",
    type: "CONNECT",
    request_id: requestId,
    ts: new Date().toISOString(),
    body: { display, relay },
  };
}

/** True when this device already holds an origin-accepted connection (durable
 * success record). Boot checks this FIRST — a reload of an already-connected
 * self-sovereign profile re-enters the app without re-running the flow. */
export function hasEstablishedConnection() {
  return Boolean(readStore(CONNECTED_KEYS.originDid));
}

/** Re-enter the app for an already-established connection (reload path): no
 * name step, no CONNECT re-send — just restore the name and drop into the
 * app with the "connected to <origin>" indicator. */
export function enterEstablishedConnection() {
  const myDisplay = readStore(CONNECTED_KEYS.myDisplay) || "You";
  const originDisplay = readStore(CONNECTED_KEYS.originDisplay) || shortDid(readStore(CONNECTED_KEYS.originDid) || "");
  enterConnected(originDisplay, myDisplay);
}

/** Persist the established-connection record so a later reload re-enters directly.
 * @param {string} originDid @param {string} originDisplay @param {string} myDisplay */
function persistConnection(originDid, originDisplay, myDisplay) {
  writeStore(CONNECTED_KEYS.originDid, originDid);
  writeStore(CONNECTED_KEYS.originDisplay, originDisplay);
  writeStore(CONNECTED_KEYS.myDisplay, myDisplay);
}

/** Enter the app as this self-sovereign profile, showing the connected-to-origin
 * indicator. `finishOnb` is the app's own entry gate (reveals tabs, seeds the
 * thin fixture floor, shows Discover); we then replace its coach chip with the
 * connection confirmation so the "you're connected to <origin>" state is
 * visible.
 * @param {string} originDisplay @param {string} myDisplay */
function enterConnected(originDisplay, myDisplay) {
  state.name = myDisplay;
  finishOnb();
  showCoach("You’re in — connected to <b>" + escapeHtml(originDisplay) + "</b>");
}

/**
 * Default name step — renders the onboarding name prompt into the onb screen
 * and resolves with the entered name. Injectable via `runConnectFlow`'s
 * `nameProvider` so tests can supply a name without driving the DOM.
 * @param {string} _connect @returns {Promise<string>}
 */
function askDisplayName(_connect) {
  return new Promise((resolve) => {
    const el = $("onbInner");
    el.setAttribute("data-anchor", "ONB-5");
    el.innerHTML =
      '<span class="eyebrow">A web of your own</span>' +
      "<h2>" + onboardingHeading() + "</h2>" +
      "<p>Your keys were just made here, on this phone. No account, no permission to ask. What do people call you?</p>" +
      '<input class="name-input" id="connectNameIn" value="" maxlength="16" aria-label="Your name" placeholder="Your name">' +
      '<div class="actions"><button class="btn btn-coral" id="connectNameDone">Ask to join</button></div>';
    $("connectNameDone").onclick = () => {
      const v = /** @type {HTMLInputElement} */ ($("connectNameIn")).value.trim();
      resolve(v || "New friend");
    };
  });
}

/** "Waiting for <origin> to let you in…" screen.
 * @param {string} connect */
function renderWaiting(connect) {
  const el = $("onbInner");
  el.setAttribute("data-anchor", "ONB-5");
  el.innerHTML =
    '<span class="eyebrow">Almost in</span>' +
    "<h2>Waiting for a yes…</h2>" +
    "<p>Your request went to <b>" + escapeHtml(shortDid(connect)) + "</b>. They’ll see who’s asking and can let you in.</p>" +
    '<div class="verse-grid" style="justify-content:center"><span>…</span></div>';
}

/** Gentle "not this time" screen for CONNECT_ACK{accepted:false}.
 * @param {string} connect */
function renderDeclined(connect) {
  const el = $("onbInner");
  el.setAttribute("data-anchor", "ONB-1");
  el.innerHTML =
    '<span class="eyebrow">Not this time</span>' +
    "<h2>Not this time</h2>" +
    "<p><b>" + escapeHtml(shortDid(connect)) + "</b> didn’t open the door just now. That’s okay — you can look around, and your keys stay yours on this phone.</p>" +
    '<div class="actions"><button class="btn btn-ghost" id="connectDeclinedLook">Just look around</button></div>';
  $("connectDeclinedLook").onclick = () => { guestMode(); };
}

/** Couldn't reach the mediator (relay unreachable / send rejected) — a browser
 * peer with no daemon has no other route, so surface it honestly rather than
 * freezing on the name screen. The keys are already made; only the reach failed.
 * @param {string} connect */
function renderRelayError(connect) {
  const el = $("onbInner");
  el.setAttribute("data-anchor", "ONB-1");
  el.innerHTML =
    '<span class="eyebrow">Couldn’t reach the door</span>' +
    "<h2>We couldn’t send your request</h2>" +
    "<p>The relay for <b>" + escapeHtml(shortDid(connect)) + "</b> didn’t answer. Your keys are safe on this phone — check the connection and reopen the link to try again.</p>" +
    '<div class="actions"><button class="btn btn-ghost" id="connectErrLook">Just look around</button></div>';
  $("connectErrLook").onclick = () => { guestMode(); };
}

/**
 * Run the self-sovereign connect flow end to end. Deps are injected so tests
 * can drive it with a mocked RelayClient + identity loader.
 *
 * @param {Object} args
 * @param {string} args.connect - origin DID to join.
 * @param {string} args.relay - mediator relay base ORIGIN.
 * @param {{ loadOrCreateIdentity: (opts?: { endpoint?: string }) => Promise<any>, createRelayClient: (opts: any) => { send: (toDid: string, env: unknown) => Promise<void>, onInbound: (cb: (fromDid: string, env: unknown) => void) => void, start: () => Promise<void>, stop: () => void } }} args.deps
 * @param {(connect: string) => Promise<string>} [args.nameProvider] - name step seam (defaults to the DOM prompt).
 * @returns {Promise<{ identity: any, client: any, accepted: boolean, error?: boolean }>}
 */
export async function runConnectFlow({ connect, relay, deps, nameProvider = askDisplayName }) {
  const { loadOrCreateIdentity, createRelayClient } = deps;

  // 1. Self-sovereign browser keys (persisted in IndexedDB). The DID advertises
  //    the mediator `relay` as its service endpoint so replies route back.
  const identity = await loadOrCreateIdentity({ endpoint: relay });

  // 2. Ask the human their display name (the app's onboarding voice).
  const rawName = await nameProvider(connect);
  const myDisplay = (rawName && String(rawName).trim()) || "New friend";

  // 3. Open the relay client to the shared mediator and register the ACK watch
  //    BEFORE sending, so a fast reply can't race ahead of the listener.
  const client = createRelayClient({ identity, relayUrl: relay });
  const requestId = newUuid();
  const acked = new Promise((resolve) => {
    client.onInbound((fromDid, envelope) => {
      const e = /** @type {any} */ (envelope);
      // Correlate on origin DID + type + the request_id we minted (the origin
      // echoes it in its CONNECT_ACK) — an unsolicited/mismatched ack is ignored.
      if (fromDid === connect && e && e.type === "CONNECT_ACK" && e.request_id === requestId) {
        resolve(e.body || {});
      }
    });
  });
  // 4. Reach the mediator and send CONNECT. A daemonless browser has no other
  //    route, so a start/send failure (relay down, fetch rejected) is terminal
  //    for this attempt — surface it instead of freezing on the name screen.
  try {
    await client.start();
    await client.send(connect, connectEnvelope(requestId, myDisplay, relay));
  } catch {
    client.stop();
    renderRelayError(connect);
    return { identity, client, accepted: false, error: true };
  }
  renderWaiting(connect);

  // 5. Resolve on the origin owner's decision.
  const body = /** @type {any} */ (await acked);
  const accepted = Boolean(body && body.accepted);
  if (accepted) {
    const originDisplay = (body.display && String(body.display)) || shortDid(connect);
    persistConnection(connect, originDisplay, myDisplay);
    enterConnected(originDisplay, myDisplay);
  } else {
    clearConnectConfig(); // forget the intent so a reload doesn't re-send to a "no"
    renderDeclined(connect);
  }

  return { identity, client, accepted };
}
