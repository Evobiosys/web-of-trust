import { describe, expect, it } from "vitest";
import {
  createDefaultCategoryPolicy,
  createDefaultPolicy,
  cycleCrossCommunityRule,
  cycleShareCell,
  describeCrossCommunityChange,
  getCrossCommunityRule,
  nextCrossCommunityRule,
  nextShareCellState,
  promoteToDefault,
  setCrossCommunityRule,
  type PermissionPolicy,
} from "./permission_policy.js";

describe("permission_policy — share-matrix cycle", () => {
  it("cycles off -> share -> ask -> once -> off", () => {
    expect(nextShareCellState("off")).toBe("share");
    expect(nextShareCellState("share")).toBe("ask");
    expect(nextShareCellState("ask")).toBe("once");
    expect(nextShareCellState("once")).toBe("off");
  });

  it("cycleShareCell advances exactly one cell and leaves the rest of the policy alone", () => {
    const policy = createDefaultPolicy({ audience: "trusted", mode: "ask_each_time" });
    const before = policy.gathering.matrix;
    const after = cycleShareCell(policy, "gathering", "close");
    expect(after.gathering.matrix.close).toBe("share"); // off -> share
    expect(after.gathering.matrix.friends).toBe(before.friends); // untouched
    expect(after.offer).toBe(policy.offer); // other category untouched (same reference)
    expect(after.gathering.primaryRing).toBe(policy.gathering.primaryRing); // slots untouched
  });

  it("is pure: does not mutate the input policy", () => {
    const policy = createDefaultPolicy({ audience: "private", mode: "ask_each_time" });
    const snapshot = JSON.stringify(policy);
    cycleShareCell(policy, "gathering", "pub");
    expect(JSON.stringify(policy)).toBe(snapshot);
  });
});

describe("permission_policy — promote to default", () => {
  it("swaps the promoted secondary slot with the old primary (not an overwrite)", () => {
    const policy = createDefaultPolicy({ audience: "trusted", mode: "ask_each_time" });
    const oldPrimary = policy.gathering.primaryRing;
    const oldSecondary = policy.gathering.secondaryRings;
    const promoted = oldSecondary[1];

    const after = promoteToDefault(policy, "gathering", 1);

    expect(after.gathering.primaryRing).toBe(promoted);
    expect(after.gathering.secondaryRings[1]).toBe(oldPrimary);
    // the other two slots are untouched
    expect(after.gathering.secondaryRings[0]).toBe(oldSecondary[0]);
    expect(after.gathering.secondaryRings[2]).toBe(oldSecondary[2]);
  });

  it("leaves the matrix untouched", () => {
    const policy = createDefaultPolicy({ audience: "wot_commons", mode: "auto_forward" });
    const after = promoteToDefault(policy, "gathering", 0);
    expect(after.gathering.matrix).toBe(policy.gathering.matrix); // same reference — not just equal
  });

  it("promoting twice with the same index round-trips to the original assignment", () => {
    const policy = createDefaultPolicy({ audience: "trusted", mode: "ask_each_time" });
    const once = promoteToDefault(policy, "gathering", 2);
    const twice = promoteToDefault(once, "gathering", 2);
    expect(twice.gathering.primaryRing).toBe(policy.gathering.primaryRing);
    expect(twice.gathering.secondaryRings).toEqual(policy.gathering.secondaryRings);
  });
});

describe("permission_policy — default seeding from AppProfile.defaultPolicy", () => {
  it("audience 'private' seeds every ring off, primary falls back to 'close' (I9 conservative default)", () => {
    const cat = createDefaultCategoryPolicy({ audience: "private", mode: "ask_each_time" });
    expect(cat.primaryRing).toBe("close");
    expect(Object.values(cat.matrix).every((s) => s === "off")).toBe(true);
  });

  it("audience 'trusted' + mode 'ask_each_time' seeds the friends ring to 'ask'", () => {
    const cat = createDefaultCategoryPolicy({ audience: "trusted", mode: "ask_each_time" });
    expect(cat.primaryRing).toBe("friends");
    expect(cat.matrix.friends).toBe("ask");
    expect(cat.matrix.close).toBe("off");
    expect(cat.matrix.commons).toBe("off");
    expect(cat.matrix.pub).toBe("off");
  });

  it("audience 'wot_commons' + mode 'auto_forward' seeds the commons ring to 'share'", () => {
    const cat = createDefaultCategoryPolicy({ audience: "wot_commons", mode: "auto_forward" });
    expect(cat.primaryRing).toBe("commons");
    expect(cat.matrix.commons).toBe("share");
  });

  it("secondaryRings are the three other rings, deterministic RING_ORDER minus the primary", () => {
    const cat = createDefaultCategoryPolicy({ audience: "trusted", mode: "ask_each_time" });
    expect(cat.secondaryRings).toEqual(["close", "commons", "pub"]);
  });

  it("createDefaultPolicy seeds every requested category with the same seed", () => {
    const policy: PermissionPolicy = createDefaultPolicy({ audience: "trusted", mode: "ask_each_time" });
    expect(policy.gathering.primaryRing).toBe("friends");
    expect(policy.offer.primaryRing).toBe("friends");
    // distinct objects per category, not aliased
    expect(policy.gathering).not.toBe(policy.offer);
  });
});

describe("permission_policy — cross-community rules", () => {
  it("cycles never -> always -> ask -> once -> never (its own vocabulary/order, distinct from the share cycle)", () => {
    expect(nextCrossCommunityRule("never")).toBe("always");
    expect(nextCrossCommunityRule("always")).toBe("ask");
    expect(nextCrossCommunityRule("ask")).toBe("once");
    expect(nextCrossCommunityRule("once")).toBe("never");
  });

  it("defaults to 'never' for an unset (category, community) pair", () => {
    expect(getCrossCommunityRule({}, "gathering", "vienna-node")).toBe("never");
  });

  it("cycleCrossCommunityRule advances one community's rule for one category only", () => {
    let rules = cycleCrossCommunityRule({}, "gathering", "vienna-node");
    expect(getCrossCommunityRule(rules, "gathering", "vienna-node")).toBe("always");
    expect(getCrossCommunityRule(rules, "offer", "vienna-node")).toBe("never"); // other category untouched
    rules = cycleCrossCommunityRule(rules, "gathering", "graz-node");
    expect(getCrossCommunityRule(rules, "gathering", "vienna-node")).toBe("always"); // unrelated community untouched
    expect(getCrossCommunityRule(rules, "gathering", "graz-node")).toBe("always");
  });

  it("setCrossCommunityRule sets an explicit value regardless of the current one", () => {
    const rules = setCrossCommunityRule({}, "offer", "graz-node", "always");
    expect(getCrossCommunityRule(rules, "offer", "graz-node")).toBe("always");
  });

  it("describeCrossCommunityChange shapes a logOwner-ready provenance entry", () => {
    const evt = describeCrossCommunityChange({ category: "gathering", communityId: "vienna-node", rule: "always" });
    expect(evt.action).toBe("cross_community_rule_set");
    expect(evt.requestId).toBe("policy:gathering:vienna-node");
    expect(evt.detail).toContain("vienna-node");
    expect(evt.detail).toContain("always");
  });
});
