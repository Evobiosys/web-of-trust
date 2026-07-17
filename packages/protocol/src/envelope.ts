// Envelope & messages — HANDOVER §6.1.
//
// { v: "0.1", type: REQUEST|STATUS|CONSENT|INTRO|WITHDRAWN, request_id: uuid, ts: iso8601, body: {...} }
//
// Design notes:
// - REQUEST.body.ttl is a duration in milliseconds until the request expires
//   (not an absolute timestamp) — the brief names it "ttl" but doesn't pin a
//   unit; milliseconds keeps it consistent with `statusDispatchAt`'s delayMs.
// - STATUS.body carries only `state`. This is the load-bearing piece of I3
//   (indistinguishable No): there is no field anywhere in this schema for a
//   PASS's cause (declined vs no-match), so it structurally cannot leak.
// - CONSENT.body.conditions is `.optional()` (never `.nullable()`/`.default("")`)
//   so an omitted value round-trips to `{}` on serialization, per D1.6.
import { z } from "zod";
import { IsoDateTimeSchema } from "./schemas.js";

const ProtocolVersionSchema = z.literal("0.1");
const RequestIdSchema = z.string().uuid();

const RequestBodySchema = z
  .object({
    text: z.string().min(1),
    lang: z.string().optional(),
    embedding: z.array(z.number()).optional(),
    area: z.string().optional(),
    /** milliseconds until this request expires. */
    ttl: z.number().int().nonnegative(),
  })
  .strict();

const StatusBodySchema = z
  .object({
    state: z.enum(["PASS", "PENDING"]),
  })
  .strict();

const ConsentBodySchema = z
  .object({
    conditions: z.string().optional(),
  })
  .strict();

const IntroBodySchema = z
  .object({
    room_id: z.string().min(1),
  })
  .strict();

const WithdrawnBodySchema = z
  .object({
    reason: z.enum(["fulfilled", "expired", "cancelled"]),
  })
  .strict();

const RequestEnvelopeSchema = z
  .object({
    v: ProtocolVersionSchema,
    type: z.literal("REQUEST"),
    request_id: RequestIdSchema,
    ts: IsoDateTimeSchema,
    body: RequestBodySchema,
  })
  .strict();

const StatusEnvelopeSchema = z
  .object({
    v: ProtocolVersionSchema,
    type: z.literal("STATUS"),
    request_id: RequestIdSchema,
    ts: IsoDateTimeSchema,
    body: StatusBodySchema,
  })
  .strict();

const ConsentEnvelopeSchema = z
  .object({
    v: ProtocolVersionSchema,
    type: z.literal("CONSENT"),
    request_id: RequestIdSchema,
    ts: IsoDateTimeSchema,
    body: ConsentBodySchema,
  })
  .strict();

const IntroEnvelopeSchema = z
  .object({
    v: ProtocolVersionSchema,
    type: z.literal("INTRO"),
    request_id: RequestIdSchema,
    ts: IsoDateTimeSchema,
    body: IntroBodySchema,
  })
  .strict();

const WithdrawnEnvelopeSchema = z
  .object({
    v: ProtocolVersionSchema,
    type: z.literal("WITHDRAWN"),
    request_id: RequestIdSchema,
    ts: IsoDateTimeSchema,
    body: WithdrawnBodySchema,
  })
  .strict();

export const EnvelopeSchema = z.discriminatedUnion("type", [
  RequestEnvelopeSchema,
  StatusEnvelopeSchema,
  ConsentEnvelopeSchema,
  IntroEnvelopeSchema,
  WithdrawnEnvelopeSchema,
]);
export type Envelope = z.infer<typeof EnvelopeSchema>;

export type RequestBody = z.infer<typeof RequestBodySchema>;
export type StatusBody = z.infer<typeof StatusBodySchema>;
export type ConsentBody = z.infer<typeof ConsentBodySchema>;
export type IntroBody = z.infer<typeof IntroBodySchema>;
export type WithdrawnBody = z.infer<typeof WithdrawnBodySchema>;

/**
 * Deterministic deep-key-sorted JSON stringify. Guarantees that two
 * structurally-equal envelopes serialize byte-identically regardless of the
 * order their fields happened to be constructed in — this is what makes the
 * I3 byte-identity test meaningful rather than accidental.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Validates the envelope, then serializes it with stable, sorted key ordering. */
export function serializeEnvelope(envelope: Envelope): string {
  const validated = EnvelopeSchema.parse(envelope);
  return JSON.stringify(canonicalize(validated));
}

/** Parses and validates an envelope from a JSON string. Throws on malformed JSON, unknown type, or extra keys. */
export function parseEnvelope(json: string): Envelope {
  const raw: unknown = JSON.parse(json);
  return EnvelopeSchema.parse(raw);
}
