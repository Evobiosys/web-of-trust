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
// - D14 (additive): LISTING/LOAN/DM reuse the same top-level envelope shape
//   (v/type/request_id/ts/body) as every other v0.1 type — no restructuring.
//   For LISTING and LOAN, the constructor (daemon/envelopes.ts) always sets
//   the top-level `request_id` equal to the body's own `listing_id`/
//   `loan_id` — the body still carries its own id (the brief's exact shape)
//   so store lookups can key off the body field alone, while the envelope's
//   `request_id` keeps every wire message uniformly correlatable the way
//   REQUEST/STATUS/CONSENT/INTRO/WITHDRAWN already are. DM has no natural
//   correlation id of its own (fire-and-forget chat), so its `request_id` is
//   just a fresh per-message uuid.
import { z } from "zod";
import { IsoDateTimeSchema, PeerIdSchema, SharePolicyAudienceSchema, TrustLevelSchema } from "./schemas.js";

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

/** D14: a resource offer or gathering, declared with an audience tier and a
 * forwarding reach (`steps`). `via` accumulates each forwarder's peer id as
 * the listing propagates (see daemon/listings.ts); the owner's own publish
 * always starts with `via: []`. `state` doubles as the withdrawal signal —
 * the owner re-broadcasts the same listing with `state: "withdrawn"` along
 * the same tier-filtered route to propagate a takedown. */
const ListingBodySchema = z
  .object({
    listing_id: z.string().min(1),
    kind: z.enum(["offer", "gathering"]),
    title: z.string().min(1),
    description: z.string(),
    when: z.string().optional(),
    where_public: z.string().optional(),
    where_gated: z.string().optional(),
    tier: SharePolicyAudienceSchema,
    steps: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    via: z.array(PeerIdSchema),
    state: z.enum(["active", "withdrawn"]),
    owner_display: z.string().min(1),
  })
  .strict();

/** D14: a borrow-lifecycle message for one listing. `note` is free text the
 * sender chooses to attach; the "not_yet" completion-detail privacy rule
 * (mockup RES-5: stays local to the parties) is enforced by the daemon
 * NEVER placing that detail into `note` on the wire — the schema itself
 * can't structurally forbid it (same shape as CONSENT.conditions), so this
 * is a daemon-layer discipline, documented at the call site
 * (daemon/listings.ts's `checkInLoanCompletion`). */
const LoanBodySchema = z
  .object({
    listing_id: z.string().min(1),
    loan_id: z.string().min(1),
    state: z.enum(["requested", "approved", "declined", "lent", "returned", "complete", "not_yet"]),
    note: z.string().optional(),
  })
  .strict();

/** D14: a direct-message chat line between two connected peers (any trust
 * level) — deliberately minimal, mirrors RoomMessage's shape but travels as
 * a proper v0.1 envelope instead of the transport-layer room-chat gap-fill,
 * since a DM thread has no room to belong to. */
const DmBodySchema = z
  .object({
    text: z.string().min(1),
  })
  .strict();

/** D18 (additive, v stays "0.1"): a brand-new self-sovereign peer's "let me
 * in" request to an origin it scanned. `display` is the requester's own
 * chosen name (I4: the origin owner sees who is asking). `relay` is an
 * optional hint of the relay/mediator the origin can reach the requester back
 * through (real-transport routing; the in-memory harness ignores it). `level`
 * is the trust level the requester WISHES for — the origin owner is never
 * bound by it (never auto-escalated; see daemon.ts's `clampConnectLevel`,
 * I9). The transport-authenticated `from` is the connecting DID — this body
 * carries NO identity field, deliberately (the envelope has no `from`). */
const ConnectBodySchema = z
  .object({
    display: z.string().min(1),
    relay: z.string().optional(),
    level: TrustLevelSchema.optional(),
  })
  .strict();

/** D18: the origin's reply to a CONNECT. `accepted:false` is a gentle,
 * minimal "not accepted" — it reveals nothing beyond that (the origin-node
 * model: the owner decided). `display` (the origin's own name) is present
 * only on `accepted:true`, so the new peer can name the edge it now forms
 * back to the origin. Echoes the CONNECT's `request_id` for correlation. */
const ConnectAckBodySchema = z
  .object({
    accepted: z.boolean(),
    display: z.string().min(1).optional(),
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

const ListingEnvelopeSchema = z
  .object({
    v: ProtocolVersionSchema,
    type: z.literal("LISTING"),
    request_id: RequestIdSchema,
    ts: IsoDateTimeSchema,
    body: ListingBodySchema,
  })
  .strict();

const LoanEnvelopeSchema = z
  .object({
    v: ProtocolVersionSchema,
    type: z.literal("LOAN"),
    request_id: RequestIdSchema,
    ts: IsoDateTimeSchema,
    body: LoanBodySchema,
  })
  .strict();

const DmEnvelopeSchema = z
  .object({
    v: ProtocolVersionSchema,
    type: z.literal("DM"),
    request_id: RequestIdSchema,
    ts: IsoDateTimeSchema,
    body: DmBodySchema,
  })
  .strict();

const ConnectEnvelopeSchema = z
  .object({
    v: ProtocolVersionSchema,
    type: z.literal("CONNECT"),
    request_id: RequestIdSchema,
    ts: IsoDateTimeSchema,
    body: ConnectBodySchema,
  })
  .strict();

const ConnectAckEnvelopeSchema = z
  .object({
    v: ProtocolVersionSchema,
    type: z.literal("CONNECT_ACK"),
    request_id: RequestIdSchema,
    ts: IsoDateTimeSchema,
    body: ConnectAckBodySchema,
  })
  .strict();

export const EnvelopeSchema = z.discriminatedUnion("type", [
  RequestEnvelopeSchema,
  StatusEnvelopeSchema,
  ConsentEnvelopeSchema,
  IntroEnvelopeSchema,
  WithdrawnEnvelopeSchema,
  ListingEnvelopeSchema,
  LoanEnvelopeSchema,
  DmEnvelopeSchema,
  ConnectEnvelopeSchema,
  ConnectAckEnvelopeSchema,
]);
export type Envelope = z.infer<typeof EnvelopeSchema>;

export type RequestBody = z.infer<typeof RequestBodySchema>;
export type StatusBody = z.infer<typeof StatusBodySchema>;
export type ConsentBody = z.infer<typeof ConsentBodySchema>;
export type IntroBody = z.infer<typeof IntroBodySchema>;
export type WithdrawnBody = z.infer<typeof WithdrawnBodySchema>;
export type ListingBody = z.infer<typeof ListingBodySchema>;
export type LoanBody = z.infer<typeof LoanBodySchema>;
export type DmBody = z.infer<typeof DmBodySchema>;
export type ConnectBody = z.infer<typeof ConnectBodySchema>;
export type ConnectAckBody = z.infer<typeof ConnectAckBodySchema>;

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
