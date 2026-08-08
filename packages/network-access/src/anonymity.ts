// k-anonymity floor for aggregate responses. Below k matches, an aggregate
// would identify people ("1 of 100 match" usually means the requester can
// guess who) — so it is suppressed. Suppressed and zero-match responses must
// stay byte-identical outward: a distinguishable suppressed response would
// itself leak "between 1 and k-1 people match".
//
// Scope note (ADR-3 / retired WEB-3 in docs/20-data-contract.md forbids
// aggregate counts about non-visible second-ring people): this aggregate is a
// different object — it counts the owner's own first-ring contacts and is
// released only by the owner's explicit Gate-2 consent (or a standing
// auto_anonymized grant the owner set). Flagged for contract review before
// this package is mounted into the daemon wire protocol.
import type { OutwardResponse } from "./types.js";

export const DEFAULT_K = 3;

export const NOTHING_SHAREABLE_TEXT = "No shareable result for this request.";

export type RevealDecision =
  | { kind: "none" }
  | { kind: "suppressed"; matchCount: number }
  | { kind: "anonymized"; matchCount: number; totalCount: number };

export function anonymizedRevealDecision(
  matchCount: number,
  totalCount: number,
  k: number = DEFAULT_K,
): RevealDecision {
  if (matchCount <= 0) return { kind: "none" };
  if (matchCount < k) return { kind: "suppressed", matchCount };
  return { kind: "anonymized", matchCount, totalCount };
}

export function outwardAnonymizedResponse(decision: RevealDecision): OutwardResponse {
  if (decision.kind === "anonymized") {
    return {
      kind: "anonymized",
      text: `${decision.matchCount} of ${decision.totalCount} people in this network match your request.`,
      matchCount: decision.matchCount,
      totalCount: decision.totalCount,
    };
  }
  return { kind: "nothing_shareable", text: NOTHING_SHAREABLE_TEXT };
}
