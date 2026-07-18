// @ts-check
// Task 8 (core-transport-plan.md): QR byte budget for a meet-card carrying
// `relays` (did:peer:2 strings, ~200-260 bytes each — see did_identity.ts).
// meet.js (out of scope for this task) already renders the card via the
// real `qrcode` package (`QRCode.toString(payload, {type:"svg", ...})`) with
// a `.catch` fallback to a text code on any encode failure, so there is
// already a runtime safety net; this file is the proof that (a) a realistic
// card with several relays fits comfortably inside a scan-reliable budget
// and round-trips through the real encoder's byte-mode segmentation, and
// (b) an unreasonably large relay list is caught by the library's own
// capacity check before it would ever reach that fallback.
//
// HONEST LABELING: "round-trips through QR encoding" here means the real
// `qrcode` library accepts the payload, capacity-checks it, and segments it
// into byte-mode chunks whose concatenated bytes we verify equal the
// original JSON — NOT a camera/pixel scan of a rendered QR image. That
// (real hardware, real lighting) is out of scope for a unit test; this
// proves the wire-level encode path is lossless and within budget.
import { describe, it, expect } from "vitest";
import QRCode from "qrcode";

/**
 * A realistic did:peer:2 string is ~200-260 bytes (two multibase-encoded
 * keys + a base64url service block — see did_identity.ts's buildDidPeer2).
 * This fixture is shaped like a real one (same element/length profile) so
 * the byte-budget math below reflects reality without needing a live
 * identity mint in this package (mobile-ui has no @resource-web/transport
 * dependency — UI talks to its own agent over HTTP only, never imports
 * domain packages directly).
 * @param {number} n
 */
function fakeRelayDid(n) {
  const kv = "Vz6Mk" + "a".repeat(43); // ~48 chars, same shape as an encoded Ed25519 key
  const ke = "Ez6LS" + "b".repeat(43);
  const svc = "S" + Buffer.from(JSON.stringify({ t: "dm", s: `http://relay${n}.example/didcomm`, a: ["didcomm/v2"] })).toString("base64url");
  return `did:peer:2.${kv}.${ke}.${svc}`;
}

/**
 * Documented QR budget for this card shape: reliable phone-camera scanning
 * at the ~180px size meet.js renders degrades well before the library's
 * hard ceiling (2331 bytes at errorCorrectionLevel "M", QRCode's default —
 * measured empirically against this exact `qrcode` version: `QRCode.create`
 * throws above this many raw bytes). 1200 bytes is a conservative practical
 * budget beneath that ceiling — no phone-hardware scan testing behind this
 * exact number (⚠ low confidence, ~0.5), it is a documented placeholder for
 * Task 10 wiring to enforce, not an empirically-tuned constant.
 */
const QR_PRACTICAL_BUDGET_BYTES = 1200;
const QR_LIBRARY_HARD_CEILING_BYTES = 2331; // errorCorrectionLevel "M", this qrcode version — see comment above.

/** @param {any} card */
function cardPayloadBytes(card) {
  return Buffer.byteLength(JSON.stringify(card), "utf8");
}

/**
 * "Decode": qrcode's `QRCode.create` splits the input into byte-mode
 * segments; concatenating their raw bytes and reparsing as JSON proves the
 * encoder stored the payload losslessly (see file header for what this test
 * does and does not prove).
 * @param {any} card
 */
function encodeThenReconstruct(card) {
  const payload = JSON.stringify(card);
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const bytes = Buffer.concat(qr.segments.map((/** @type {any} */ s) => Buffer.from(s.data)));
  return { qr, reconstructed: JSON.parse(bytes.toString("utf8")) };
}

describe("QR card byte budget (Task 8)", () => {
  it("a card with 3 relay DIDs fits the documented practical budget and round-trips losslessly through the real QR encoder", () => {
    const card = {
      display: "Anna",
      did: fakeRelayDid(0),
      endpoint: "http://anna.example/didcomm",
      relays: [fakeRelayDid(1), fakeRelayDid(2), fakeRelayDid(3)],
    };
    expect(cardPayloadBytes(card)).toBeLessThanOrEqual(QR_PRACTICAL_BUDGET_BYTES);

    const { qr, reconstructed } = encodeThenReconstruct(card);
    expect(reconstructed).toEqual(card);
    expect(qr.version).toBeGreaterThan(0); // a real QR version was selected, not a no-op
  });

  it("a card with no relays (existing mock-transport shape) round-trips too — Task 8 is additive, not a floor", () => {
    const card = { display: "Anna", did: fakeRelayDid(0), endpoint: "http://anna.example/didcomm" };
    const { reconstructed } = encodeThenReconstruct(card);
    expect(reconstructed).toEqual(card);
  });

  it("a card with enough relays to exceed the real encoder's capacity throws — the documented guard, not silent truncation", () => {
    const tooMany = Array.from({ length: 20 }, (_, i) => fakeRelayDid(i + 1)); // ~20 * ~230 bytes ≈ 4.6KB
    const card = { display: "Anna", did: fakeRelayDid(0), endpoint: "http://anna.example/didcomm", relays: tooMany };
    expect(cardPayloadBytes(card)).toBeGreaterThan(QR_LIBRARY_HARD_CEILING_BYTES);
    expect(() => QRCode.create(JSON.stringify(card), { errorCorrectionLevel: "M" })).toThrow(/too big/i);
  });

  it("QR_PRACTICAL_BUDGET_BYTES stays below the library's hard ceiling (sanity check on the two documented numbers)", () => {
    expect(QR_PRACTICAL_BUDGET_BYTES).toBeLessThan(QR_LIBRARY_HARD_CEILING_BYTES);
  });
});
