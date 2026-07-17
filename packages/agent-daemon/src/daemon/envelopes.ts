// Envelope constructors — thin wrappers that also run EnvelopeSchema.parse
// (via the protocol package's own validation, exercised through
// serializeEnvelope) so a lifecycle bug producing a malformed envelope fails
// loudly in tests rather than silently reaching the wire.
import { EnvelopeSchema, type Envelope, type WithdrawnReason } from "@resource-web/protocol";

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
