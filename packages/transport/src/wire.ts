// Matrix wire format for resource-web envelopes — HANDOVER-adjacent, transport-owned (not protocol).
//
// Envelopes travel as ordinary `m.room.message` events so any Matrix client
// (Element, etc.) can at least see something readable in the timeline,
// while the canonical machine-readable payload rides alongside under a
// custom key. `msgtype` and the content key intentionally share the same
// string — one namespaced identifier for "this is a resource-web envelope",
// not two independently-evolving constants.
export const ENVELOPE_MSGTYPE = "app.resource-web.envelope";
export const ENVELOPE_CONTENT_KEY = "app.resource-web.envelope";

/** Human-readable fallback body for clients that don't understand the msgtype. */
export function fallbackBody(envelopeType: string): string {
  return `resource-web envelope: ${envelopeType}`;
}

export interface EnvelopeMessageContent {
  msgtype: typeof ENVELOPE_MSGTYPE;
  body: string;
  [ENVELOPE_CONTENT_KEY]: string;
}

/** Builds the `m.room.message` content object carrying a serialized envelope. */
export function buildEnvelopeContent(envelopeType: string, serializedEnvelope: string): EnvelopeMessageContent {
  return {
    msgtype: ENVELOPE_MSGTYPE,
    body: fallbackBody(envelopeType),
    [ENVELOPE_CONTENT_KEY]: serializedEnvelope,
  };
}

/** Extracts the serialized envelope string from a room message event's content, or undefined if it isn't one of ours. */
export function extractEnvelopeWire(content: unknown): string | undefined {
  if (typeof content !== "object" || content === null) return undefined;
  const record = content as Record<string, unknown>;
  if (record.msgtype !== ENVELOPE_MSGTYPE) return undefined;
  const wire = record[ENVELOPE_CONTENT_KEY];
  return typeof wire === "string" ? wire : undefined;
}
