// Shared test fixtures — one envelope per type, used by both MockTransport
// and MatrixTransport test suites so "all five envelope types round-trip" is
// asserted against literally the same fixture data on both adapters (I5).
import type { Envelope } from "@resource-web/protocol";

export const FIXTURE_REQUEST_ID = "5f1e5c2a-9d3e-4a2b-8f1a-1e2d3c4b5a6f";
export const FIXTURE_TS = "2026-01-01T00:00:00.000Z";

/** One fixture envelope per type: REQUEST, STATUS, CONSENT, INTRO, WITHDRAWN. */
export const ENVELOPE_FIXTURES: Envelope[] = [
  { v: "0.1", type: "REQUEST", request_id: FIXTURE_REQUEST_ID, ts: FIXTURE_TS, body: { text: "Looking for a drill", ttl: 3_600_000 } },
  { v: "0.1", type: "STATUS", request_id: FIXTURE_REQUEST_ID, ts: FIXTURE_TS, body: { state: "PASS" } },
  { v: "0.1", type: "CONSENT", request_id: FIXTURE_REQUEST_ID, ts: FIXTURE_TS, body: { conditions: "weekends only" } },
  { v: "0.1", type: "INTRO", request_id: FIXTURE_REQUEST_ID, ts: FIXTURE_TS, body: { room_id: "room-1" } },
  { v: "0.1", type: "WITHDRAWN", request_id: FIXTURE_REQUEST_ID, ts: FIXTURE_TS, body: { reason: "fulfilled" } },
];
