import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "./policy.js";
import { ItemSchema, TrustEdgeSchema, type Item, type TrustEdge } from "./schemas.js";
import type { RequestBody } from "./envelope.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");

const baseRequest: RequestBody = { text: "Looking for a drill", ttl: 60_000 };

function makeItem(overrides: Partial<Parameters<typeof ItemSchema.parse>[0]> = {}): Item {
  return ItemSchema.parse({
    id: "item-1",
    labels: ["drill"],
    description: "cordless drill",
    tags: ["tools"],
    provenance: { kind: "self" },
    policy: {},
    ...overrides,
  });
}

function makeEdge(overrides: Partial<Parameters<typeof TrustEdgeSchema.parse>[0]> = {}): TrustEdge {
  return TrustEdgeSchema.parse({
    peer: "@anna:matrix.example.org",
    display: "Anna",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("evaluatePolicy — audience gating", () => {
  it("private is never eligible, even with a valid edge", () => {
    const item = makeItem({ policy: { audience: "private" } });
    const edge = makeEdge();
    const result = evaluatePolicy(item, baseRequest, edge, NOW);
    expect(result.eligible).toBe(false);
  });

  it("trusted requires a valid non-expired edge", () => {
    const item = makeItem({ policy: { audience: "trusted" } });
    const result = evaluatePolicy(item, baseRequest, undefined, NOW);
    expect(result.eligible).toBe(false);
  });

  it("trusted is eligible with a valid edge", () => {
    const item = makeItem({ policy: { audience: "trusted" } });
    const edge = makeEdge({ expires_at: "2027-01-01T00:00:00.000Z" });
    const result = evaluatePolicy(item, baseRequest, edge, NOW);
    expect(result.eligible).toBe(true);
  });

  it("trusted is not eligible if the edge itself has expired", () => {
    const item = makeItem({ policy: { audience: "trusted" } });
    const edge = makeEdge({ created_at: "2020-01-01T00:00:00.000Z", expires_at: "2021-01-01T00:00:00.000Z" });
    const result = evaluatePolicy(item, baseRequest, edge, NOW);
    expect(result.eligible).toBe(false);
  });

  it("wot_commons is eligible without a trust edge (discoverable without per-request ping)", () => {
    const item = makeItem({ policy: { audience: "wot_commons" } });
    const result = evaluatePolicy(item, baseRequest, undefined, NOW);
    expect(result.eligible).toBe(true);
  });
});

describe("evaluatePolicy — mode drives needsConsent independently of audience", () => {
  it("ask_each_time (default) needs consent", () => {
    const item = makeItem({ policy: { audience: "wot_commons", mode: "ask_each_time" } });
    const result = evaluatePolicy(item, baseRequest, undefined, NOW);
    expect(result.needsConsent).toBe(true);
  });

  it("auto_forward does not need consent", () => {
    const item = makeItem({ policy: { audience: "wot_commons", mode: "auto_forward" } });
    const result = evaluatePolicy(item, baseRequest, undefined, NOW);
    expect(result.needsConsent).toBe(false);
  });
});

describe("evaluatePolicy — expiry (I9)", () => {
  it("an expired policy is not eligible even for an otherwise-eligible trusted edge", () => {
    const item = makeItem({ policy: { audience: "trusted", expires_at: "2026-01-01T00:00:00.000Z" } });
    const edge = makeEdge({ expires_at: "2027-01-01T00:00:00.000Z" });
    const result = evaluatePolicy(item, baseRequest, edge, NOW);
    expect(result.eligible).toBe(false);
  });

  it("a policy expiring exactly at `now` counts as expired", () => {
    const item = makeItem({ policy: { audience: "wot_commons", expires_at: NOW.toISOString() } });
    const result = evaluatePolicy(item, baseRequest, undefined, NOW);
    expect(result.eligible).toBe(false);
  });
});

describe("evaluatePolicy — requires pass-through", () => {
  it("surfaces the item's consent-context requirements unchanged", () => {
    const item = makeItem({
      policy: { audience: "trusted", requires: ["profile_photo", "note_from_requester"] },
    });
    const edge = makeEdge({ expires_at: "2027-01-01T00:00:00.000Z" });
    const result = evaluatePolicy(item, baseRequest, edge, NOW);
    expect(result.requires).toEqual(["profile_photo", "note_from_requester"]);
  });

  it("defaults requires to an empty array when unset", () => {
    const item = makeItem({ policy: { audience: "trusted" } });
    const edge = makeEdge({ expires_at: "2027-01-01T00:00:00.000Z" });
    const result = evaluatePolicy(item, baseRequest, edge, NOW);
    expect(result.requires).toEqual([]);
  });
});
