// Envelope constructors — thin wrappers that also run EnvelopeSchema.parse
// (via the protocol package's own validation, exercised through
// serializeEnvelope) so a lifecycle bug producing a malformed envelope fails
// loudly in tests rather than silently reaching the wire.
import {
  EnvelopeSchema,
  type ConnectAckBody,
  type ConnectBody,
  type DmBody,
  type Envelope,
  type ListingBody,
  type LoanBody,
  type WithdrawnReason,
} from "@resource-web/protocol";

function validated(env: Envelope): Envelope {
  return EnvelopeSchema.parse(env);
}

export function requestEnvelope(
  requestId: string,
  ts: Date,
  body: { text: string; lang?: string; embedding?: number[]; area?: string; ttl: number }
): Envelope {
  return validated({ v: "0.1", type: "REQUEST", request_id: requestId, ts: ts.toISOString(), body });
}

/** I3: this is the ONLY constructor of STATUS envelopes. Its body carries
 * nothing but `state` — there is structurally no field for "why" (declined
 * vs no-match), which is what makes a PASS built here for either cause
 * byte-identical to serializeEnvelope. */
export function statusEnvelope(requestId: string, ts: Date, state: "PASS" | "PENDING"): Envelope {
  return validated({ v: "0.1", type: "STATUS", request_id: requestId, ts: ts.toISOString(), body: { state } });
}

export function consentEnvelope(requestId: string, ts: Date, conditions?: string): Envelope {
  return validated({ v: "0.1", type: "CONSENT", request_id: requestId, ts: ts.toISOString(), body: { conditions } });
}

export function introEnvelope(requestId: string, ts: Date, roomId: string): Envelope {
  return validated({ v: "0.1", type: "INTRO", request_id: requestId, ts: ts.toISOString(), body: { room_id: roomId } });
}

export function withdrawnEnvelope(requestId: string, ts: Date, reason: WithdrawnReason): Envelope {
  return validated({ v: "0.1", type: "WITHDRAWN", request_id: requestId, ts: ts.toISOString(), body: { reason } });
}

/** D14: envelope.request_id is always body.listing_id (see envelope.ts's design note). */
export function listingEnvelope(ts: Date, body: ListingBody): Envelope {
  return validated({ v: "0.1", type: "LISTING", request_id: body.listing_id, ts: ts.toISOString(), body });
}

/** D14: envelope.request_id is always body.loan_id (see envelope.ts's design note). */
export function loanEnvelope(ts: Date, body: LoanBody): Envelope {
  return validated({ v: "0.1", type: "LOAN", request_id: body.loan_id, ts: ts.toISOString(), body });
}

/** D14: DM has no natural correlation id, so request_id is a fresh per-message uuid. */
export function dmEnvelope(requestId: string, ts: Date, body: DmBody): Envelope {
  return validated({ v: "0.1", type: "DM", request_id: requestId, ts: ts.toISOString(), body });
}

/** D18: a new peer's "let me in" request to an origin. `request_id` is a
 * fresh uuid the requester mints and the origin echoes in its CONNECT_ACK. */
export function connectEnvelope(requestId: string, ts: Date, body: ConnectBody): Envelope {
  return validated({ v: "0.1", type: "CONNECT", request_id: requestId, ts: ts.toISOString(), body });
}

/** D18: the origin's reply — `request_id` echoes the CONNECT it answers. */
export function connectAckEnvelope(requestId: string, ts: Date, body: ConnectAckBody): Envelope {
  return validated({ v: "0.1", type: "CONNECT_ACK", request_id: requestId, ts: ts.toISOString(), body });
}
