import { describe, expect, it } from "vitest";
import { applyEvent, GateError, receiveQuery, requesterView, startProactiveReachOut } from "./gates.js";
import { DEFAULT_REQUESTER_POLICY } from "./types.js";
import type { ContactMatch, Gate0Policy, Gate1Policy, Gate2Policy, IntroQuery, RequesterPolicy } from "./types.js";

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

describe("proactive reach-out (Gate-2 family, Delta 1)", () => {
  const profile = { id: "general", name: "Jakob", contact: "connect@evobiosys.org" };

  it("owner can compose an outward reach-out on a query awaiting reveal", () => {
    const { query } = runToMatched(DEFAULT_REQUESTER_POLICY, 2);
    const { query: q2 } = applyEvent(
      query,
      { type: "proactive_reach_out", profile, message: "saw your ask — let's talk" },
      DEFAULT_REQUESTER_POLICY,
    );
    const view = requesterView(q2);
    expect(view.state).toBe("answered");
    expect(view.profile).toEqual(profile);
    expect(view.message).toBe("saw your ask — let's talk");
    expect(view.text).toContain("saw your ask — let's talk");
    expect(view.text).toContain(profile.contact);
  });

  it("owner can reach out before running the matcher at all (awaiting_gate0 / awaiting_run)", () => {
    const { query } = receiveQuery(base, DEFAULT_REQUESTER_POLICY);
    expect(query.state).toBe("awaiting_gate0");
    const { query: q2 } = applyEvent(
      query,
      { type: "proactive_reach_out", profile, message: "no need to wait — reach out" },
      DEFAULT_REQUESTER_POLICY,
    );
    expect(q2.state).toBe("responded");
    expect(requesterView(q2).profile).toEqual(profile);
  });

  it("throws once the query is already terminal (responded/declined/expired)", () => {
    const answered = applyEvent(
      runToMatched(DEFAULT_REQUESTER_POLICY, 2).query,
      { type: "reveal_anonymized" },
      DEFAULT_REQUESTER_POLICY,
    ).query;
    expect(() =>
      applyEvent(answered, { type: "proactive_reach_out", profile, message: "hi" }, DEFAULT_REQUESTER_POLICY),
    ).toThrow(GateError);
  });

  it("rejects an empty message", () => {
    const { query } = receiveQuery(base, DEFAULT_REQUESTER_POLICY);
    expect(() =>
      applyEvent(query, { type: "proactive_reach_out", profile, message: "   " }, DEFAULT_REQUESTER_POLICY),
    ).toThrow(GateError);
  });

  it("startProactiveReachOut builds a standalone query toward a known requester with no inbound ask", () => {
    const { query } = startProactiveReachOut(
      { id: "standalone-1", requester: "mira", receivedAt: 42 },
      profile,
      "thought of you for this",
    );
    expect(query.origin).toBe("owner");
    expect(query.state).toBe("responded");
    const view = requesterView(query);
    expect(view.profile).toEqual(profile);
    expect(view.message).toBe("thought of you for this");
  });

  it("is reachable ONLY via the explicit owner event — no policy combination ever emits it automatically", () => {
    const gate0s: Gate0Policy[] = ["blocked", "ask_each_time", "standing_allow"];
    const gate1s: Gate1Policy[] = ["manual", "auto_small"];
    const gate2s: Gate2Policy[] = ["manual", "auto_anonymized", "auto_reveal_identity"];
    const seenKinds = new Set<string>();

    for (const gate0 of gate0s) {
      for (const gate1 of gate1s) {
        for (const gate2 of gate2s) {
          const policy: RequesterPolicy = { gate0, gate1, gate2 };
          // Drive every automatic path as far as it goes: receiveQuery may
          // already respond (blocked) or auto-run (standing_allow+auto_small);
          // if it reaches "running", complete the match automatically too —
          // still with no explicit event of any kind besides that lifecycle one.
          let { query, effects } = receiveQuery(base, policy);
          if (effects[0]?.type === "respond") seenKinds.add(effects[0].response.kind);
          if (query.state === "running") {
            const result = applyEvent(
              query,
              { type: "match_completed", matches: matches(5), totalContacts: 100 },
              policy,
              { defaultProfile: profile },
            );
            query = result.query;
            for (const eff of result.effects) if (eff.type === "respond") seenKinds.add(eff.response.kind);
          }
          // Also probe the manual gate0/gate1 progression for combinations
          // that hold at awaiting_gate0 / awaiting_run — advance them by
          // hand through gate0_allow/run (still no proactive_reach_out event)
          // and complete the match, covering the manual/manual/* matrix too.
          if (policy.gate0 === "ask_each_time") {
            let manual = receiveQuery(base, policy).query;
            ({ query: manual } = applyEvent(manual, { type: "gate0_allow" }, policy));
            if (manual.state === "awaiting_run") {
              ({ query: manual } = applyEvent(manual, { type: "run", model: "small" }, policy));
            }
            if (manual.state === "running") {
              const result = applyEvent(
                manual,
                { type: "match_completed", matches: matches(5), totalContacts: 100 },
                policy,
                { defaultProfile: profile },
              );
              for (const eff of result.effects) if (eff.type === "respond") seenKinds.add(eff.response.kind);
            }
          }
        }
      }
    }

    expect(seenKinds.has("proactive_reach_out")).toBe(false);
    // sanity: the sweep did actually exercise other automatic outward kinds,
    // so an absent "proactive_reach_out" is meaningful, not a no-op sweep.
    expect(seenKinds.size).toBeGreaterThan(0);
  });
});
