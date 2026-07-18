// @ts-check
// Task 2 (QR-onboarding): builds the "connect URL" a fresh device's NATIVE
// camera app opens from the origin's Meet-screen QR. The alpha runs over
// plain HTTP on a LAN IP, so in-app camera scanning (getUserMedia /
// BarcodeDetector) needs a secure context that isn't available there — the
// QR must instead encode a URL the phone's own camera app hands to the
// browser. Deliberately carries NO `persona` param: a brand-new device must
// land on full onboarding (create-your-own-profile), never auto-login as an
// existing persona — see main.js's persona-vs-fresh-device branch.

/**
 * @typedef {Object} MeetCard
 * @property {string} [peer_id] - GET /api/card's non-DIDComm peer id.
 * @property {string} [display] - GET /api/card's display name.
 * @property {string} [did] - present only when TRANSPORT=didcomm (Task 11's
 * getCardPayload); absent for mock/matrix transport.
 * @property {string} [endpoint] - this agent's own DIDComm inbound endpoint URL.
 * @property {string[]} [relays] - relay-node DIDs (Task 8) this peer is
 * reachable through — DIDs, not URLs, so not directly usable as a `relay=`
 * query value yet.
 * @property {string} [relay_url] - Task 5: the HTTP base ORIGIN of the shared
 * trust-graph mediator this origin's daemon routes through. This IS a URL a
 * browser can open — the value the connect URL's `relay=` param carries so the
 * scanning device points its RelayClient at the mediator (not this origin's
 * own endpoint), matching the daemon's own `RelayChannel` target (topology:
 * every daemon drains the single shared mediator).
 */

/**
 * Build the connect URL a fresh device's camera opens:
 * `<origin>/?connect=<did>&relay=<relayUrl>&app=<appId>` — no `persona` param.
 *
 * `relay` carries the shared trust-graph mediator's base ORIGIN
 * (`card.relay_url`, Task 5) — the URL the scanning device points its
 * RelayClient at so its CONNECT reaches this origin the same way every daemon
 * routes: via the single mediator each daemon drains. Falls back to the
 * origin's own didcomm endpoint (`card.endpoint`) only when a card predates
 * `relay_url` (defensive; the alpha's daemon always supplies `relay_url`).
 *
 * @param {string} origin - window.location.origin
 * @param {MeetCard | null | undefined} card - GET /api/card response
 * @param {string} appId - runtime_config's appId
 * @returns {string | null} the connect URL, or null when the card carries no
 * `did` (mock/matrix transport — no DIDComm identity to connect to yet; I1 —
 * never invent one).
 */
export function buildConnectUrl(origin, card, appId) {
  const did = card && card.did;
  if (!did) return null;
  const relay = (card && (card.relay_url || card.endpoint)) || "";
  const url = new URL(origin);
  url.search = "";
  url.hash = "";
  url.searchParams.set("connect", did);
  url.searchParams.set("relay", relay);
  url.searchParams.set("app", appId);
  return url.toString();
}
