// Network-access queries ("who can the owner introduce me to?") and the
// owner-side consent ladder:
//   Gate 0 — may this requester query at all?
//   Gate 1 — run the matcher now, and with which local model?
//   Gate 2 — is the result shared, and in which form?
// Two hard rules live in this package: identified reveals are NEVER automatic,
// and anonymized aggregates exist only at k or above (see anonymity.ts).

export type Gate0Policy = "blocked" | "ask_each_time" | "standing_allow";
export type Gate1Policy = "manual" | "auto_small";
export type Gate2Policy = "manual" | "auto_anonymized" | "auto_reveal_identity";

export interface RequesterPolicy {
  gate0: Gate0Policy;
  gate1: Gate1Policy;
  gate2: Gate2Policy;
}

export const DEFAULT_REQUESTER_POLICY: RequesterPolicy = {
  gate0: "ask_each_time",
  gate1: "manual",
  gate2: "manual",
};

export type ModelSize = "small" | "large";

export interface ContactRecord {
  id: string;
  name: string;
  tags: string[];
  notes: string;
  /** Where this person is correlated from, e.g. ["linkedin", "transcripts"]. */
  networks?: string[];
}

export interface ContactMatch {
  contact_id: string;
  score: number;
  reason: string;
}

export type QueryState =
  | "awaiting_gate0"
  | "declined_gate0"
  | "awaiting_run"
  | "running"
  | "awaiting_reveal"
  | "responded"
  | "declined_reveal"
  | "expired";

/** Owner-side record of how a query was answered. Never sent outward as-is —
 * requesters only ever see the output of requesterView() (see gates.ts). */
export type OutwardKind =
  | "nothing_shareable"
  | "anonymized"
  | "identified"
  | "identity_revealed"
  | "proactive_reach_out"
  | "declined";

export interface OutwardResponse {
  kind: OutwardKind;
  text: string;
  matchCount?: number;
  totalCount?: number;
  contacts?: { name: string; reason: string }[];
  profile?: OwnerProfile;
  /** Owner's free-text message, present on proactive_reach_out only. */
  message?: string;
}

/** A reach-out card the owner can attach when revealing their identity.
 * Multiple profiles allowed (general + per-use-case alter egos). */
export interface OwnerProfile {
  id: string;
  name: string;
  contact: string;
  blurb?: string;
}

export interface IntroQuery {
  id: string;
  requester: string;
  text: string;
  receivedAt: number;
  state: QueryState;
  model?: ModelSize;
  matches?: ContactMatch[];
  totalContacts?: number;
  response?: OutwardResponse;
  /** "owner" marks a standalone proactive_reach_out the owner started toward
   * a known requester with no inbound query (Delta 1). Absent/"requester" =
   * the ordinary requester-initiated query. */
  origin?: "requester" | "owner";
}
