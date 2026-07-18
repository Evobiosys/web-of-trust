// Data model — HANDOVER §5.1. Zod schemas + inferred TS types.
//
// Design note on defaults (I9 conservative defaults):
// - SharePolicy.audience/mode/expires_at carry schema-level `.default()`. That
//   means the *input* type may omit them, but the *parsed/output* type always
//   has them present (zod drops `| undefined` from defaulted fields). This is
//   deliberate: every SharePolicy that has passed through this schema is fully
//   resolved, so downstream code (evaluatePolicy) never has to special-case
//   "no expiry set".
// - TrustEdge.expires_at defaults relative to its own `created_at` (not to
//   "now") via an object-level `.transform`, since an edge's expiry is a
//   property of when the edge was created, not of when it happens to be
//   parsed.
import { z } from "zod";

/** v0: matrix user id (e.g. "@anna:matrix.example.org"); later: DID. */
export const PeerIdSchema = z.string().min(1);
export type PeerId = z.infer<typeof PeerIdSchema>;

/** Wire timestamps are always UTC ISO-8601 with a trailing "Z" (matches `Date#toISOString()`). */
export const IsoDateTimeSchema = z.string().datetime();

/** now+1y as an ISO-8601 UTC string. `now` defaults to the real clock; pass it explicitly in tests. */
export function defaultExpiryIso(now: Date | string = new Date()): string {
  const base = typeof now === "string" ? new Date(now) : now;
  const result = new Date(base);
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  return result.toISOString();
}

/**
 * D14 (additive, v0.1 stays frozen): the trust ladder a listing's `tier`
 * (SharePolicyAudienceSchema, below) is filtered against. Ordered
 * contact < friend < close — "close" is the inner room, "friend" is the
 * default connection level (I9 conservative default), "contact" is the
 * loosest tier a direct edge can carry.
 */
export const TrustLevelSchema = z.enum(["contact", "friend", "close"]);
export type TrustLevel = z.infer<typeof TrustLevelSchema>;

export const TrustEdgeSchema = z
  .object({
    peer: PeerIdSchema,
    display: z.string().min(1),
    /** who introduced them — future governance hook (not evaluated in v0). */
    vouched_by: PeerIdSchema.optional(),
    /** D14: trust-ladder level, default "friend" (I9 conservative default). */
    level: TrustLevelSchema.default("friend"),
    created_at: IsoDateTimeSchema,
    expires_at: IsoDateTimeSchema.optional(),
  })
  .strict()
  .transform((edge) => ({
    ...edge,
    expires_at: edge.expires_at ?? defaultExpiryIso(edge.created_at),
  }));
export type TrustEdge = z.infer<typeof TrustEdgeSchema>;

/**
 * D14: "close"/"public" are new (additive) tiers — "close" = inner room
 * (never forwarded, see daemon/listings.ts), "trusted" = the "Friends" tier
 * from the mockup, "wot_commons" = "The Commons" (reachable through the web
 * of trust without a direct edge), "public" = wot_commons's reach PLUS
 * visibility in guest/unauthenticated local API responses (Task 5's concern;
 * this package only defines the value).
 */
export const SharePolicyAudienceSchema = z.enum(["private", "close", "trusted", "wot_commons", "public"]);
export const SharePolicyModeSchema = z.enum(["ask_each_time", "auto_forward"]);
export const SharePolicyRequirementSchema = z.enum(["profile_photo", "note_from_requester"]);

export const SharePolicySchema = z
  .object({
    audience: SharePolicyAudienceSchema.default("trusted"),
    mode: SharePolicyModeSchema.default("ask_each_time"),
    requires: z.array(SharePolicyRequirementSchema).optional(),
    expires_at: IsoDateTimeSchema.default(() => defaultExpiryIso()),
  })
  .strict();
export type SharePolicy = z.infer<typeof SharePolicySchema>;

export const ProvenanceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("self") }).strict(),
  z
    .object({
      kind: z.literal("second_brain"),
      owner: PeerIdSchema,
      noted_at: IsoDateTimeSchema,
    })
    .strict(),
]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const ItemSchema = z
  .object({
    id: z.string().min(1),
    labels: z.array(z.string()),
    description: z.string(),
    tags: z.array(z.string()),
    provenance: ProvenanceSchema,
    policy: SharePolicySchema,
    /** coarse only, e.g. "Wien-Ottakring" — never precise coordinates. */
    location_area: z.string().optional(),
    availability: z.string().optional(),
  })
  .strict();
export type Item = z.infer<typeof ItemSchema>;
