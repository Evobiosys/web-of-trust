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
import type {
  ContactMatch,
  ContactRecord,
  IntroQuery,
  ModelSize,
  OutwardResponse,
  OwnerProfile,
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
  return view;
}
