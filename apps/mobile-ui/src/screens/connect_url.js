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
 */

/**
 * Build the connect URL a fresh device's camera opens:
 * `<origin>/?connect=<did>&relay=<relayUrl>&app=<appId>` — no `persona` param.
 *
 * `relay` is presently the origin's OWN didcomm inbound endpoint
 * (`card.endpoint`), not a dedicated relay service: /api/card's `relays[]`
 * (Task 8) carries relay-node DIDs, not URLs a browser can open, so there is
 * nothing else to point at yet.
 * TODO(Task3): use a dedicated relay URL once one exists in the card payload.
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
  const relay = (card && card.endpoint) || "";
  const url = new URL(origin);
  url.search = "";
  url.hash = "";
  url.searchParams.set("connect", did);
  url.searchParams.set("relay", relay);
  url.searchParams.set("app", appId);
  return url.toString();
}
