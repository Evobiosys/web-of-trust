// Pure query-lifecycle reducer. All state changes flow through receiveQuery()
// and applyEvent(); effects (start a matcher run, deliver a response) are
// returned as data so the host — demo server today, agent-daemon later — owns
// all I/O. requesterView() is the single outward view builder, mirroring the
// api/sanitize.ts chokepoint pattern in agent-daemon.
import {
  anonymizedRevealDecision,
  outwardAnonymizedResponse,
  NOTHING_SHAREABLE_TEXT,
  DEFAULT_K,
} from "./anonymity.js";
import { DEFAULT_REQUESTER_POLICY } from "./types.js";
import type {
  ContactMatch,
  ContactRecord,
  IntroQuery,
  ModelSize,
  OutwardResponse,
  OwnerProfile,
  QueryState,
  RequesterPolicy,
} from "./types.js";

export type GateEvent =
  | { type: "gate0_allow" }
  | { type: "gate0_block" }
  | { type: "run"; model: ModelSize }
  | { type: "match_completed"; matches: ContactMatch[]; totalContacts: number }
  | { type: "reveal_anonymized" }
  | { type: "reveal_identified"; contactIds: string[] }
  | { type: "reveal_identity"; profile: OwnerProfile }
  | { type: "proactive_reach_out"; profile: OwnerProfile; message: string }
  | { type: "decline_reveal" }
  | { type: "expire" };

export type GateEffect =
  | { type: "start_match"; model: ModelSize }
  | { type: "respond"; response: OutwardResponse };

export interface TransitionResult {
  query: IntroQuery;
  effects: GateEffect[];
}

export class GateError extends Error {}

function startRun(query: IntroQuery, model: ModelSize): TransitionResult {
  return {
    query: { ...query, state: "running", model },
    effects: [{ type: "start_match", model }],
  };
}

/** Gate-0 passed: either wait for a manual run decision or auto-run small. */
function afterGate0(query: IntroQuery, policy: RequesterPolicy): TransitionResult {
  if (policy.gate1 === "auto_small") return startRun(query, "small");
  return { query: { ...query, state: "awaiting_run" }, effects: [] };
}

export function receiveQuery(
  input: { id: string; requester: string; text: string; receivedAt: number },
  policy: RequesterPolicy,
): TransitionResult {
  const query: IntroQuery = { ...input, state: "awaiting_gate0" };
  switch (policy.gate0) {
    case "blocked":
      // Blocked requesters get the same outward text as no-result requesters —
      // being blocked must not be detectable.
      return {
        query: {
          ...query,
          state: "declined_gate0",
          response: { kind: "declined", text: NOTHING_SHAREABLE_TEXT },
        },
        effects: [{ type: "respond", response: { kind: "declined", text: NOTHING_SHAREABLE_TEXT } }],
      };
    case "standing_allow":
      return afterGate0(query, policy);
    case "ask_each_time":
      return { query, effects: [] };
  }
}

function respondWith(query: IntroQuery, state: IntroQuery["state"], response: OutwardResponse): TransitionResult {
  return {
    query: { ...query, state, response },
    effects: [{ type: "respond", response }],
  };
}

function identityResponse(profile: OwnerProfile): OutwardResponse {
  return {
    kind: "identity_revealed",
    text: `${profile.name} is sharing something that fits your request — reach out directly: ${profile.contact}`,
    profile,
  };
}

function proactiveReachOutResponse(profile: OwnerProfile, message: string): OutwardResponse {
  return {
    kind: "proactive_reach_out",
    text: `${profile.name} wanted to reach out: "${message}" — ${profile.contact}`,
    profile,
    message,
  };
}

const TERMINAL_STATES = new Set<QueryState>(["responded", "declined_reveal", "declined_gate0", "expired"]);

/** Builds a fresh, gate-less query for a standalone proactive reach-out: the
 * owner reaching toward a known requester with no inbound ask driving it.
 * Immediately applies the proactive_reach_out event so the resulting query
 * is born already "responded" — it flows through the same outward path
 * (requesterView / demo relay push) as any other answered query. */
export function startProactiveReachOut(
  input: { id: string; requester: string; receivedAt: number },
  profile: OwnerProfile,
  message: string,
): TransitionResult {
  const query: IntroQuery = {
    id: input.id,
    requester: input.requester,
    text: "",
    receivedAt: input.receivedAt,
    state: "awaiting_gate0",
    origin: "owner",
  };
  // Policy plays no role in this branch (an explicit owner event, never
  // policy-driven) — DEFAULT_REQUESTER_POLICY is passed only to satisfy
  // applyEvent's signature.
  return applyEvent(query, { type: "proactive_reach_out", profile, message }, DEFAULT_REQUESTER_POLICY);
}

export function applyEvent(
  query: IntroQuery,
  event: GateEvent,
  policy: RequesterPolicy,
  options?: { k?: number; contactsById?: Map<string, ContactRecord>; defaultProfile?: OwnerProfile },
): TransitionResult {
  const k = options?.k ?? DEFAULT_K;
  switch (event.type) {
    case "gate0_allow": {
      if (query.state !== "awaiting_gate0") throw new GateError(`gate0_allow in ${query.state}`);
      return afterGate0(query, policy);
    }
    case "gate0_block": {
      if (query.state !== "awaiting_gate0") throw new GateError(`gate0_block in ${query.state}`);
      return respondWith(query, "declined_gate0", { kind: "declined", text: NOTHING_SHAREABLE_TEXT });
    }
    case "run": {
      if (query.state !== "awaiting_run") throw new GateError(`run in ${query.state}`);
      return startRun(query, event.model);
    }
    case "match_completed": {
      if (query.state !== "running") throw new GateError(`match_completed in ${query.state}`);
      const matched: IntroQuery = {
        ...query,
        matches: event.matches,
        totalContacts: event.totalContacts,
      };
      if (policy.gate2 === "auto_anonymized") {
        const decision = anonymizedRevealDecision(event.matches.length, event.totalContacts, k);
        return respondWith(matched, "responded", outwardAnonymizedResponse(decision));
      }
      if (policy.gate2 === "auto_reveal_identity") {
        // Full-trust path: the owner's OWN identity may auto-reveal on a hit —
        // it exposes no third party, so the k-floor does not apply. No hit
        // still answers with the indistinguishable no-result text.
        if (event.matches.length > 0 && options?.defaultProfile) {
          return respondWith(matched, "responded", identityResponse(options.defaultProfile));
        }
        return respondWith(matched, "responded", { kind: "nothing_shareable", text: NOTHING_SHAREABLE_TEXT });
      }
      return { query: { ...matched, state: "awaiting_reveal" }, effects: [] };
    }
    case "reveal_anonymized": {
      if (query.state !== "awaiting_reveal") throw new GateError(`reveal_anonymized in ${query.state}`);
      const decision = anonymizedRevealDecision(
        query.matches?.length ?? 0,
        query.totalContacts ?? 0,
        k,
      );
      return respondWith(query, "responded", outwardAnonymizedResponse(decision));
    }
    case "reveal_identified": {
      // Only ever reachable through an explicit owner event — there is no
      // policy that automates this branch, by design.
      if (query.state !== "awaiting_reveal") throw new GateError(`reveal_identified in ${query.state}`);
      if (event.contactIds.length === 0) throw new GateError("reveal_identified with no contacts");
      const matchIds = new Set((query.matches ?? []).map((m) => m.contact_id));
      const contacts = event.contactIds.map((id) => {
        if (!matchIds.has(id)) throw new GateError(`contact ${id} is not among the matches`);
        const record = options?.contactsById?.get(id);
        const match = (query.matches ?? []).find((m) => m.contact_id === id);
        return { name: record?.name ?? id, reason: match?.reason ?? "" };
      });
      return respondWith(query, "responded", {
        kind: "identified",
        text: `${contacts.length} introduction(s) offered — the owner chose to share these directly.`,
        contacts,
      });
    }
    case "reveal_identity": {
      // "Tell them it's my identity" — the owner steps forward so the
      // requester can reach out. Reveals the owner only, never the matches.
      if (query.state !== "awaiting_reveal") throw new GateError(`reveal_identity in ${query.state}`);
      return respondWith(query, "responded", identityResponse(event.profile));
    }
    case "proactive_reach_out": {
      // Explicit owner action ONLY — never reachable from an automatic
      // policy branch (contrast match_completed's auto_anonymized /
      // auto_reveal_identity arms above, neither of which mentions this
      // event type). Allowed from any pre-answer state: the owner may reach
      // out before, during, or instead of running the matcher (the
      // standalone case, via startProactiveReachOut, starts here too).
      if (TERMINAL_STATES.has(query.state)) {
        throw new GateError(`proactive_reach_out in ${query.state}`);
      }
      if (!event.message.trim()) throw new GateError("proactive_reach_out requires a non-empty message");
      return respondWith(query, "responded", proactiveReachOutResponse(event.profile, event.message));
    }
    case "decline_reveal": {
      if (query.state !== "awaiting_reveal") throw new GateError(`decline_reveal in ${query.state}`);
      return respondWith(query, "declined_reveal", { kind: "declined", text: NOTHING_SHAREABLE_TEXT });
    }
    case "expire": {
      if (query.state === "responded" || query.state === "declined_reveal" || query.state === "declined_gate0") {
        return { query, effects: [] };
      }
      return respondWith(query, "expired", { kind: "declined", text: NOTHING_SHAREABLE_TEXT });
    }
  }
}

/** The ONLY shape a requester ever sees. Owner-side kinds (declined vs
 * nothing_shareable vs suppressed) are collapsed here on purpose. */
export interface RequesterQueryView {
  id: string;
  state: "pending" | "answered";
  text?: string;
  matchCount?: number;
  totalCount?: number;
  contacts?: { name: string; reason: string }[];
  profile?: OwnerProfile;
  message?: string;
}

export function requesterView(query: IntroQuery): RequesterQueryView {
  if (!query.response) return { id: query.id, state: "pending" };
  const r = query.response;
  const view: RequesterQueryView = { id: query.id, state: "answered", text: r.text };
  if (r.kind === "anonymized") {
    view.matchCount = r.matchCount;
    view.totalCount = r.totalCount;
  }
  if (r.kind === "identified") view.contacts = r.contacts;
  if (r.kind === "identity_revealed") view.profile = r.profile;
  if (r.kind === "proactive_reach_out") {
    view.profile = r.profile;
    view.message = r.message;
  }
  return view;
}
