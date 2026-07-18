// SharePolicy evaluation — HANDOVER §5.1/§6.1, invariant I9.
//
// This function has exactly two independent jobs, kept independent
// deliberately (see the "wot_commons" note below):
//
//   1. Audience gating -> `eligible`
//      - private:      never eligible.
//      - close:        (D14) eligible only with a valid, non-expired trust
//                      edge at level "close" specifically — strictly
//                      narrower than "trusted", never more permissive (I1
//                      direction). No shipped Item fixture uses this value
//                      yet; the guard exists so the audience enum's D14
//                      extension (close/public, added for listing tiers)
//                      can't silently fall through to the wot_commons
//                      no-edge-required branch below for an Item.
//      - trusted:      eligible only with a valid, non-expired trust edge.
//      - wot_commons:  eligible without needing a trust edge at all ("discoverable
//                      through me without per-request ping" — this describes the
//                      *audience* check, i.e. no edge lookup is required to decide
//                      eligibility; it is NOT a statement about consent-per-request,
//                      which is `mode`'s job below).
//      - public:       (D14) at least as open as wot_commons — eligible
//                      without a trust edge. Guest/unauthenticated exposure
//                      itself is an API-layer concern (Task 5), out of scope
//                      here; this package only guarantees "public" is never
//                      *more* restrictive than wot_commons.
//      An expired SharePolicy, or (for "trusted"/"close") an expired edge,
//      makes an item not eligible regardless of audience.
//
//   2. Mode -> `needsConsent`
//      - ask_each_time: true
//      - auto_forward:  false
//      This is independent of audience: a wot_commons item with mode
//      "ask_each_time" still needs a per-request consent ping; only its
//      *discoverability* skipped the edge check. Flagging this reading
//      explicitly since the brief's one-line gloss on wot_commons could be
//      misread as "never needs consent" — it isn't, per the brief's own
//      two-bullet structure (audience gating vs. mode).
import type { Item, TrustEdge } from "./schemas.js";
import type { RequestBody } from "./envelope.js";

type SharePolicyRequirement = NonNullable<Item["policy"]["requires"]>[number];

export interface PolicyEvaluation {
  eligible: boolean;
  needsConsent: boolean;
  requires: SharePolicyRequirement[];
}

function isExpired(expiresAtIso: string, now: Date): boolean {
  return new Date(expiresAtIso).getTime() <= now.getTime();
}

export function evaluatePolicy(
  item: Item,
  _request: RequestBody,
  edge: TrustEdge | undefined,
  now: Date | string
): PolicyEvaluation {
  const nowDate = typeof now === "string" ? new Date(now) : now;
  const policy = item.policy;
  const requires = policy.requires ?? [];
  const needsConsent = policy.mode === "ask_each_time";

  if (policy.audience === "private") {
    return { eligible: false, needsConsent, requires };
  }

  if (isExpired(policy.expires_at, nowDate)) {
    return { eligible: false, needsConsent, requires };
  }

  if (policy.audience === "trusted") {
    const edgeValid = edge !== undefined && !isExpired(edge.expires_at, nowDate);
    if (!edgeValid) {
      return { eligible: false, needsConsent, requires };
    }
  }

  if (policy.audience === "close") {
    const edgeValid = edge !== undefined && !isExpired(edge.expires_at, nowDate) && edge.level === "close";
    if (!edgeValid) {
      return { eligible: false, needsConsent, requires };
    }
  }

  // wot_commons and public fall through here: eligible without an edge check.
  return { eligible: true, needsConsent, requires };
}
