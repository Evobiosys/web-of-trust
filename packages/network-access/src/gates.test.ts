import { describe, expect, it } from "vitest";
import { applyEvent, GateError, receiveQuery, requesterView } from "./gates.js";
import { DEFAULT_REQUESTER_POLICY } from "./types.js";
import type { ContactMatch, IntroQuery, RequesterPolicy } from "./types.js";

const base = { id: "q1", requester: "mira", text: "intro to a permaculture person in Vienna", receivedAt: 1 };

function matches(n: number): ContactMatch[] {
  return Array.from({ length: n }, (_, i) => ({
    contact_id: `c${i}`,
    score: 0.9,
    reason: "tag overlap",
  }));
}

describe("gate 0 — may they query", () => {
  it("holds at awaiting_gate0 under ask_each_time", () => {
    const { query, effects } = receiveQuery(base, DEFAULT_REQUESTER_POLICY);
    expect(query.state).toBe("awaiting_gate0");
    expect(effects).toEqual([]);
  });

  it("skips to awaiting_run under standing_allow", () => {
    const policy: RequesterPolicy = { ...DEFAULT_REQUESTER_POLICY, gate0: "standing_allow" };
    expect(receiveQuery(base, policy).query.state).toBe("awaiting_run");
  });

  it("blocked requesters get the indistinguishable no-result response", () => {
    const policy: RequesterPolicy = { ...DEFAULT_REQUESTER_POLICY, gate0: "blocked" };
    const { query } = receiveQuery(base, policy);
    expect(query.state).toBe("declined_gate0");
    expect(requesterView(query).text).toBe("No shareable result for this request.");
  });
});

describe("gate 1 — run the algorithm", () => {
  it("auto_small starts a small-model run straight from gate 0", () => {
    const policy: RequesterPolicy = { gate0: "standing_allow", gate1: "auto_small", gate2: "manual" };
    const { query, effects } = receiveQuery(base, policy);
    expect(query.state).toBe("running");
    expect(effects).toEqual([{ type: "start_match", model: "small" }]);
  });

  it("manual run requires gate 0 to have passed", () => {
    const { query } = receiveQuery(base, DEFAULT_REQUESTER_POLICY);
    expect(() => applyEvent(query, { type: "run", model: "large" }, DEFAULT_REQUESTER_POLICY)).toThrow(GateError);
  });

  it("owner picks the model on manual run", () => {
    let { query } = receiveQuery(base, DEFAULT_REQUESTER_POLICY);
    ({ query } = applyEvent(query, { type: "gate0_allow" }, DEFAULT_REQUESTER_POLICY));
    const result = applyEvent(query, { type: "run", model: "large" }, DEFAULT_REQUESTER_POLICY);
    expect(result.query.model).toBe("large");
    expect(result.effects).toEqual([{ type: "start_match", model: "large" }]);
  });
});

function runToMatched(policy: RequesterPolicy, n: number, total = 100): { query: IntroQuery } {
  let { query } = receiveQuery(base, policy);
  if (query.state === "awaiting_gate0") ({ query } = applyEvent(query, { type: "gate0_allow" }, policy));
  if (query.state === "awaiting_run") ({ query } = applyEvent(query, { type: "run", model: "small" }, policy));
  ({ query } = applyEvent(query, { type: "match_completed", matches: matches(n), totalContacts: total }, policy));
  return { query };
}

describe("gate 2 — share the result", () => {
  it("holds at awaiting_reveal under manual policy", () => {
    const { query } = runToMatched(DEFAULT_REQUESTER_POLICY, 3);
    expect(query.state).toBe("awaiting_reveal");
    expect(requesterView(query).state).toBe("pending");
  });

  it("auto_anonymized responds immediately with the aggregate at k or above", () => {
    const policy: RequesterPolicy = { gate0: "standing_allow", gate1: "auto_small", gate2: "auto_anonymized" };
    const { query } = runToMatched(policy, 3);
    expect(query.state).toBe("responded");
    expect(requesterView(query)).toMatchObject({ state: "answered", matchCount: 3, totalCount: 100 });
  });

  it("auto_anonymized below k responds with the no-result text, never the count", () => {
    const policy: RequesterPolicy = { gate0: "standing_allow", gate1: "auto_small", gate2: "auto_anonymized" };
    const { query } = runToMatched(policy, 2);
    const view = requesterView(query);
    expect(view.text).toBe("No shareable result for this request.");
    expect(view.matchCount).toBeUndefined();
  });

  it("manual anonymized reveal below k is also suppressed", () => {
    const { query } = runToMatched(DEFAULT_REQUESTER_POLICY, 1);
    const { query: q2 } = applyEvent(query, { type: "reveal_anonymized" }, DEFAULT_REQUESTER_POLICY);
    expect(requesterView(q2).text).toBe("No shareable result for this request.");
  });

  it("identified reveal requires an explicit owner event and matched ids", () => {
    const { query } = runToMatched(DEFAULT_REQUESTER_POLICY, 2);
    expect(() =>
      applyEvent(query, { type: "reveal_identified", contactIds: ["not-a-match"] }, DEFAULT_REQUESTER_POLICY),
    ).toThrow(GateError);
    const { query: q2 } = applyEvent(
      query,
      { type: "reveal_identified", contactIds: ["c0"] },
      DEFAULT_REQUESTER_POLICY,
    );
    expect(requesterView(q2).contacts).toEqual([{ name: "c0", reason: "tag overlap" }]);
  });

  it("owner can reveal their identity so the requester reaches out", () => {
    const { query } = runToMatched(DEFAULT_REQUESTER_POLICY, 2);
    const profile = { id: "general", name: "Jakob", contact: "connect@evobiosys.org" };
    const { query: q2 } = applyEvent(query, { type: "reveal_identity", profile }, DEFAULT_REQUESTER_POLICY);
    const view = requesterView(q2);
    expect(view.profile).toEqual(profile);
    expect(view.text).toContain("reach out directly");
    expect(view.contacts).toBeUndefined();
  });

  it("auto_reveal_identity policy reveals on a hit, stays silent on none", () => {
    const policy: RequesterPolicy = { gate0: "standing_allow", gate1: "auto_small", gate2: "auto_reveal_identity" };
    const profile = { id: "general", name: "Jakob", contact: "connect@evobiosys.org" };
    let { query } = receiveQuery(base, policy);
    ({ query } = applyEvent(query, { type: "match_completed", matches: matches(1), totalContacts: 12 }, policy, {
      defaultProfile: profile,
    }));
    expect(requesterView(query).profile).toEqual(profile);
    let { query: q0 } = receiveQuery(base, policy);
    ({ query: q0 } = applyEvent(q0, { type: "match_completed", matches: [], totalContacts: 12 }, policy, {
      defaultProfile: profile,
    }));
    expect(requesterView(q0).text).toBe("No shareable result for this request.");
    expect(requesterView(q0).profile).toBeUndefined();
  });

  it("decline, block, expiry, and no-result all read identically to the requester", () => {
    const declined = applyEvent(
      runToMatched(DEFAULT_REQUESTER_POLICY, 5).query,
      { type: "decline_reveal" },
      DEFAULT_REQUESTER_POLICY,
    ).query;
    const blocked = receiveQuery(base, { ...DEFAULT_REQUESTER_POLICY, gate0: "blocked" }).query;
    const expired = applyEvent(
      receiveQuery(base, DEFAULT_REQUESTER_POLICY).query,
      { type: "expire" },
      DEFAULT_REQUESTER_POLICY,
    ).query;
    const none = applyEvent(
      runToMatched(DEFAULT_REQUESTER_POLICY, 0).query,
      { type: "reveal_anonymized" },
      DEFAULT_REQUESTER_POLICY,
    ).query;
    const texts = [declined, blocked, expired, none].map((q) => requesterView(q).text);
    expect(new Set(texts).size).toBe(1);
  });
});
