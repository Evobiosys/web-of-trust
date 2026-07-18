import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PeerIdSchema,
  TrustEdgeSchema,
  ItemSchema,
  SharePolicySchema,
  ProvenanceSchema,
  defaultExpiryIso,
  type TrustEdge,
  type Item,
  type SharePolicy,
} from "./schemas.js";

describe("PeerIdSchema", () => {
  it("accepts any non-empty string (v0: matrix user id)", () => {
    expect(PeerIdSchema.parse("@anna:matrix.example.org")).toBe("@anna:matrix.example.org");
  });

  it("rejects empty string", () => {
    expect(() => PeerIdSchema.parse("")).toThrow();
  });
});

describe("defaultExpiryIso", () => {
  it("yields exactly now+1y as ISO string given an injected now", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const result = defaultExpiryIso(now);
    expect(result).toBe("2027-01-01T00:00:00.000Z");
  });

  it("accepts an ISO string as input too", () => {
    expect(defaultExpiryIso("2026-06-15T12:00:00.000Z")).toBe("2027-06-15T12:00:00.000Z");
  });
});

describe("TrustEdgeSchema", () => {
  const base = {
    peer: "@ben:matrix.example.org",
    display: "Ben",
    created_at: "2026-01-01T00:00:00.000Z",
  };

  it("parses a minimal edge and defaults expires_at to created_at+1y (I9)", () => {
    const edge: TrustEdge = TrustEdgeSchema.parse(base);
    expect(edge.expires_at).toBe("2027-01-01T00:00:00.000Z");
  });

  it("preserves an explicit expires_at when provided", () => {
    const edge = TrustEdgeSchema.parse({ ...base, expires_at: "2030-01-01T00:00:00.000Z" });
    expect(edge.expires_at).toBe("2030-01-01T00:00:00.000Z");
  });

  it("accepts optional vouched_by", () => {
    const edge = TrustEdgeSchema.parse({ ...base, vouched_by: "@carla:matrix.example.org" });
    expect(edge.vouched_by).toBe("@carla:matrix.example.org");
  });

  it("rejects unknown keys (strict)", () => {
    expect(() => TrustEdgeSchema.parse({ ...base, extra: "nope" })).toThrow();
  });

  it("rejects malformed created_at", () => {
    expect(() => TrustEdgeSchema.parse({ ...base, created_at: "not-a-date" })).toThrow();
  });

  it("defaults level to 'friend' when omitted", () => {
    const edge = TrustEdgeSchema.parse(base);
    expect(edge.level).toBe("friend");
  });

  it("accepts explicit level 'contact' and 'close'", () => {
    expect(TrustEdgeSchema.parse({ ...base, level: "contact" }).level).toBe("contact");
    expect(TrustEdgeSchema.parse({ ...base, level: "close" }).level).toBe("close");
  });

  it("rejects an invalid level value", () => {
    expect(() => TrustEdgeSchema.parse({ ...base, level: "bestie" })).toThrow();
  });
});

describe("SharePolicySchema (I9 conservative defaults)", () => {
  afterEach(() => vi.useRealTimers());

  it("defaults audience to 'trusted' and mode to 'ask_each_time' when omitted", () => {
    const policy: SharePolicy = SharePolicySchema.parse({});
    expect(policy.audience).toBe("trusted");
    expect(policy.mode).toBe("ask_each_time");
  });

  it("defaults expires_at to now+1y when omitted (fake system clock)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
    const policy = SharePolicySchema.parse({});
    expect(policy.expires_at).toBe("2027-03-01T00:00:00.000Z");
  });

  it("preserves explicit audience/mode/expires_at", () => {
    const policy = SharePolicySchema.parse({
      audience: "wot_commons",
      mode: "auto_forward",
      expires_at: "2028-01-01T00:00:00.000Z",
    });
    expect(policy).toMatchObject({
      audience: "wot_commons",
      mode: "auto_forward",
      expires_at: "2028-01-01T00:00:00.000Z",
    });
  });

  it("accepts requires[] enum values", () => {
    const policy = SharePolicySchema.parse({ requires: ["profile_photo", "note_from_requester"] });
    expect(policy.requires).toEqual(["profile_photo", "note_from_requester"]);
  });

  it("rejects invalid audience value", () => {
    expect(() => SharePolicySchema.parse({ audience: "carrier_pigeon" })).toThrow();
  });

  it("accepts the new 'close' and 'public' audience tiers (D14)", () => {
    expect(SharePolicySchema.parse({ audience: "close" }).audience).toBe("close");
    expect(SharePolicySchema.parse({ audience: "public" }).audience).toBe("public");
  });

  it("rejects invalid requires entries", () => {
    expect(() => SharePolicySchema.parse({ requires: ["carrier_pigeon"] })).toThrow();
  });

  it("rejects unknown keys (strict)", () => {
    expect(() => SharePolicySchema.parse({ extra: true })).toThrow();
  });
});

describe("ProvenanceSchema", () => {
  it("accepts { kind: 'self' } with no extra keys", () => {
    expect(ProvenanceSchema.parse({ kind: "self" })).toEqual({ kind: "self" });
  });

  it("rejects extra keys on 'self'", () => {
    expect(() => ProvenanceSchema.parse({ kind: "self", owner: "x" })).toThrow();
  });

  it("accepts second_brain with owner + noted_at", () => {
    const p = ProvenanceSchema.parse({
      kind: "second_brain",
      owner: "@anna:matrix.example.org",
      noted_at: "2026-01-01T00:00:00.000Z",
    });
    expect(p).toMatchObject({ kind: "second_brain", owner: "@anna:matrix.example.org" });
  });

  it("rejects second_brain missing owner", () => {
    expect(() => ProvenanceSchema.parse({ kind: "second_brain", noted_at: "2026-01-01T00:00:00.000Z" })).toThrow();
  });

  it("rejects unknown kind", () => {
    expect(() => ProvenanceSchema.parse({ kind: "hearsay" })).toThrow();
  });
});

describe("ItemSchema", () => {
  const validItem = {
    id: "item-1",
    labels: ["drill"],
    description: "cordless drill",
    tags: ["tools"],
    provenance: { kind: "self" as const },
    policy: {},
  };

  it("parses a minimal valid item, filling policy defaults", () => {
    const item: Item = ItemSchema.parse(validItem);
    expect(item.policy.audience).toBe("trusted");
    expect(item.policy.mode).toBe("ask_each_time");
  });

  it("accepts location_area and availability as optional coarse strings", () => {
    const item = ItemSchema.parse({ ...validItem, location_area: "Wien-Ottakring", availability: "weekends" });
    expect(item.location_area).toBe("Wien-Ottakring");
  });

  it("rejects unknown keys (strict) — e.g. accidental precise coordinates", () => {
    expect(() => ItemSchema.parse({ ...validItem, gps: [48.2, 16.3] })).toThrow();
  });

  it("rejects missing required fields", () => {
    const { description, ...rest } = validItem;
    expect(() => ItemSchema.parse(rest)).toThrow();
  });
});
