import { describe, it, expect } from "vitest";
import { EnvelopeSchema, serializeEnvelope, parseEnvelope, type Envelope } from "./envelope.js";

const REQUEST_ID = "5f1e5c2a-9d3e-4a2b-8f1a-1e2d3c4b5a6f";
const TS = "2026-01-01T00:00:00.000Z";

describe("EnvelopeSchema — REQUEST", () => {
  it("parses a valid REQUEST envelope", () => {
    const env = EnvelopeSchema.parse({
      v: "0.1",
      type: "REQUEST",
      request_id: REQUEST_ID,
      ts: TS,
      body: { text: "Looking for a cordless drill", ttl: 3_600_000 },
    });
    expect(env.type).toBe("REQUEST");
  });

  it("accepts optional lang/embedding/area", () => {
    const env = EnvelopeSchema.parse({
      v: "0.1",
      type: "REQUEST",
      request_id: REQUEST_ID,
      ts: TS,
      body: { text: "Bohrmaschine gesucht", lang: "de", embedding: [0.1, 0.2], area: "Wien-Ottakring", ttl: 60_000 },
    });
    if (env.type !== "REQUEST") throw new Error("expected REQUEST");
    expect(env.body.lang).toBe("de");
  });

  it("rejects a REQUEST body missing required text/ttl", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "REQUEST", request_id: REQUEST_ID, ts: TS, body: {} })
    ).toThrow();
  });

  it("rejects extra keys in REQUEST body (strict)", () => {
    expect(() =>
      EnvelopeSchema.parse({
        v: "0.1",
        type: "REQUEST",
        request_id: REQUEST_ID,
        ts: TS,
        body: { text: "x", ttl: 1000, precise_gps: [1, 2] },
      })
    ).toThrow();
  });
});

describe("EnvelopeSchema — STATUS", () => {
  it("accepts state PASS with no other keys", () => {
    const env = EnvelopeSchema.parse({
      v: "0.1",
      type: "STATUS",
      request_id: REQUEST_ID,
      ts: TS,
      body: { state: "PASS" },
    });
    if (env.type !== "STATUS") throw new Error("expected STATUS");
    expect(env.body).toEqual({ state: "PASS" });
  });

  it("accepts state PENDING", () => {
    const env = EnvelopeSchema.parse({
      v: "0.1",
      type: "STATUS",
      request_id: REQUEST_ID,
      ts: TS,
      body: { state: "PENDING" },
    });
    if (env.type !== "STATUS") throw new Error("expected STATUS");
    expect(env.body.state).toBe("PENDING");
  });

  it("rejects an invented cause field on PASS (I3: body carries no cause)", () => {
    expect(() =>
      EnvelopeSchema.parse({
        v: "0.1",
        type: "STATUS",
        request_id: REQUEST_ID,
        ts: TS,
        body: { state: "PASS", cause: "declined" },
      })
    ).toThrow();
  });

  it("rejects an unknown state value", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "STATUS", request_id: REQUEST_ID, ts: TS, body: { state: "MAYBE" } })
    ).toThrow();
  });
});

describe("EnvelopeSchema — CONSENT", () => {
  it("accepts an empty body (conditions omitted)", () => {
    const env = EnvelopeSchema.parse({ v: "0.1", type: "CONSENT", request_id: REQUEST_ID, ts: TS, body: {} });
    if (env.type !== "CONSENT") throw new Error("expected CONSENT");
    expect(env.body.conditions).toBeUndefined();
  });

  it("serializes an omitted conditions field to an empty body {} (D1.6)", () => {
    const json = serializeEnvelope({
      v: "0.1",
      type: "CONSENT",
      request_id: REQUEST_ID,
      ts: TS,
      body: {},
    });
    expect(JSON.parse(json).body).toEqual({});
    expect(json).toContain('"body":{}');
  });

  it("accepts conditions text (D1.6 amendment)", () => {
    const env = EnvelopeSchema.parse({
      v: "0.1",
      type: "CONSENT",
      request_id: REQUEST_ID,
      ts: TS,
      body: { conditions: "return within a week" },
    });
    if (env.type !== "CONSENT") throw new Error("expected CONSENT");
    expect(env.body.conditions).toBe("return within a week");
  });
});

describe("EnvelopeSchema — INTRO", () => {
  it("requires room_id", () => {
    const env = EnvelopeSchema.parse({
      v: "0.1",
      type: "INTRO",
      request_id: REQUEST_ID,
      ts: TS,
      body: { room_id: "!room:matrix.example.org" },
    });
    if (env.type !== "INTRO") throw new Error("expected INTRO");
    expect(env.body.room_id).toBe("!room:matrix.example.org");
  });

  it("rejects a missing room_id", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "INTRO", request_id: REQUEST_ID, ts: TS, body: {} })
    ).toThrow();
  });
});

describe("EnvelopeSchema — WITHDRAWN", () => {
  it.each(["fulfilled", "expired", "cancelled"] as const)("accepts reason=%s", (reason) => {
    const env = EnvelopeSchema.parse({
      v: "0.1",
      type: "WITHDRAWN",
      request_id: REQUEST_ID,
      ts: TS,
      body: { reason },
    });
    if (env.type !== "WITHDRAWN") throw new Error("expected WITHDRAWN");
    expect(env.body.reason).toBe(reason);
  });

  it("rejects an invalid reason", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "WITHDRAWN", request_id: REQUEST_ID, ts: TS, body: { reason: "bored" } })
    ).toThrow();
  });
});

describe("EnvelopeSchema — LISTING (D14: listings/loans/DM extension)", () => {
  const baseBody = {
    listing_id: REQUEST_ID,
    kind: "offer" as const,
    title: "Cordless drill",
    description: "Bosch IXO, barely used.",
    tier: "trusted" as const,
    steps: 2 as const,
    via: [] as string[],
    state: "active" as const,
    owner_display: "Ben",
  };

  it("parses a minimal valid LISTING envelope", () => {
    const env = EnvelopeSchema.parse({ v: "0.1", type: "LISTING", request_id: REQUEST_ID, ts: TS, body: baseBody });
    if (env.type !== "LISTING") throw new Error("expected LISTING");
    expect(env.body.tier).toBe("trusted");
    expect(env.body.steps).toBe(2);
  });

  it("accepts optional when/where_public/where_gated", () => {
    const env = EnvelopeSchema.parse({
      v: "0.1",
      type: "LISTING",
      request_id: REQUEST_ID,
      ts: TS,
      body: { ...baseBody, when: "Saturday afternoon", where_public: "Wien-Ottakring", where_gated: "Herbeckstraße 12" },
    });
    if (env.type !== "LISTING") throw new Error("expected LISTING");
    expect(env.body.where_gated).toBe("Herbeckstraße 12");
  });

  it("accepts kind='gathering'", () => {
    const env = EnvelopeSchema.parse({
      v: "0.1",
      type: "LISTING",
      request_id: REQUEST_ID,
      ts: TS,
      body: { ...baseBody, kind: "gathering" },
    });
    if (env.type !== "LISTING") throw new Error("expected LISTING");
    expect(env.body.kind).toBe("gathering");
  });

  it("accepts every tier value, including the new close/public", () => {
    for (const tier of ["private", "close", "trusted", "wot_commons", "public"] as const) {
      const env = EnvelopeSchema.parse({
        v: "0.1",
        type: "LISTING",
        request_id: REQUEST_ID,
        ts: TS,
        body: { ...baseBody, tier },
      });
      if (env.type !== "LISTING") throw new Error("expected LISTING");
      expect(env.body.tier).toBe(tier);
    }
  });

  it("accepts steps 1, 2, or 3", () => {
    for (const steps of [1, 2, 3] as const) {
      const env = EnvelopeSchema.parse({ v: "0.1", type: "LISTING", request_id: REQUEST_ID, ts: TS, body: { ...baseBody, steps } });
      if (env.type !== "LISTING") throw new Error("expected LISTING");
      expect(env.body.steps).toBe(steps);
    }
  });

  it("rejects steps outside 1..3", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "LISTING", request_id: REQUEST_ID, ts: TS, body: { ...baseBody, steps: 4 } })
    ).toThrow();
  });

  it("accepts a non-empty via chain (forwarders so far)", () => {
    const env = EnvelopeSchema.parse({
      v: "0.1",
      type: "LISTING",
      request_id: REQUEST_ID,
      ts: TS,
      body: { ...baseBody, via: ["@anna:wot.local"] },
    });
    if (env.type !== "LISTING") throw new Error("expected LISTING");
    expect(env.body.via).toEqual(["@anna:wot.local"]);
  });

  it("accepts state='withdrawn'", () => {
    const env = EnvelopeSchema.parse({ v: "0.1", type: "LISTING", request_id: REQUEST_ID, ts: TS, body: { ...baseBody, state: "withdrawn" } });
    if (env.type !== "LISTING") throw new Error("expected LISTING");
    expect(env.body.state).toBe("withdrawn");
  });

  it("rejects an invalid tier", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "LISTING", request_id: REQUEST_ID, ts: TS, body: { ...baseBody, tier: "everyone" } })
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    const { title, ...rest } = baseBody;
    void title;
    expect(() => EnvelopeSchema.parse({ v: "0.1", type: "LISTING", request_id: REQUEST_ID, ts: TS, body: rest })).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "LISTING", request_id: REQUEST_ID, ts: TS, body: { ...baseBody, precise_gps: [1, 2] } })
    ).toThrow();
  });
});

describe("EnvelopeSchema — LOAN (D14)", () => {
  const baseBody = { listing_id: REQUEST_ID, loan_id: "6a2e5c2a-9d3e-4a2b-8f1a-1e2d3c4b5a70", state: "requested" as const };

  it.each(["requested", "approved", "declined", "lent", "returned", "complete", "not_yet"] as const)(
    "accepts state=%s",
    (state) => {
      const env = EnvelopeSchema.parse({ v: "0.1", type: "LOAN", request_id: REQUEST_ID, ts: TS, body: { ...baseBody, state } });
      if (env.type !== "LOAN") throw new Error("expected LOAN");
      expect(env.body.state).toBe(state);
    }
  );

  it("accepts an optional note", () => {
    const env = EnvelopeSchema.parse({ v: "0.1", type: "LOAN", request_id: REQUEST_ID, ts: TS, body: { ...baseBody, note: "back by Sunday" } });
    if (env.type !== "LOAN") throw new Error("expected LOAN");
    expect(env.body.note).toBe("back by Sunday");
  });

  it("rejects an invalid state", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "LOAN", request_id: REQUEST_ID, ts: TS, body: { ...baseBody, state: "maybe" } })
    ).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "LOAN", request_id: REQUEST_ID, ts: TS, body: { ...baseBody, extra: true } })
    ).toThrow();
  });
});

describe("EnvelopeSchema — DM (D14)", () => {
  it("accepts a plain text body", () => {
    const env = EnvelopeSchema.parse({ v: "0.1", type: "DM", request_id: REQUEST_ID, ts: TS, body: { text: "Hey, still around Saturday?" } });
    if (env.type !== "DM") throw new Error("expected DM");
    expect(env.body.text).toBe("Hey, still around Saturday?");
  });

  it("rejects an empty text", () => {
    expect(() => EnvelopeSchema.parse({ v: "0.1", type: "DM", request_id: REQUEST_ID, ts: TS, body: { text: "" } })).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "DM", request_id: REQUEST_ID, ts: TS, body: { text: "hi", extra: 1 } })
    ).toThrow();
  });
});

describe("EnvelopeSchema — versioning & discrimination", () => {
  it("rejects a non-'0.1' version", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.2", type: "STATUS", request_id: REQUEST_ID, ts: TS, body: { state: "PASS" } })
    ).toThrow();
  });

  it("rejects an unknown envelope type", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "PING", request_id: REQUEST_ID, ts: TS, body: {} })
    ).toThrow();
  });

  it("rejects extra top-level keys", () => {
    expect(() =>
      EnvelopeSchema.parse({
        v: "0.1",
        type: "STATUS",
        request_id: REQUEST_ID,
        ts: TS,
        body: { state: "PASS" },
        extra: true,
      })
    ).toThrow();
  });

  it("rejects a non-uuid request_id", () => {
    expect(() =>
      EnvelopeSchema.parse({ v: "0.1", type: "STATUS", request_id: "not-a-uuid", ts: TS, body: { state: "PASS" } })
    ).toThrow();
  });
});

describe("serializeEnvelope / parseEnvelope round-trip", () => {
  const envelope: Envelope = {
    v: "0.1",
    type: "STATUS",
    request_id: REQUEST_ID,
    ts: TS,
    body: { state: "PASS" },
  };

  it("round-trips through serialize/parse", () => {
    const json = serializeEnvelope(envelope);
    const parsed = parseEnvelope(json);
    expect(parsed).toEqual(envelope);
  });

  it("parseEnvelope throws on malformed JSON", () => {
    expect(() => parseEnvelope("{not json")).toThrow();
  });

  it("parseEnvelope throws on an unknown type", () => {
    expect(() => parseEnvelope(JSON.stringify({ ...envelope, type: "PING" }))).toThrow();
  });

  it("parseEnvelope throws on extra keys", () => {
    expect(() => parseEnvelope(JSON.stringify({ ...envelope, extra: 1 }))).toThrow();
  });
});

describe("I3 — indistinguishable No: PASS bodies are byte-identical regardless of cause", () => {
  // Two independent call sites simulate "declined" vs "no-match" origins. Neither
  // may thread a cause into the body — the schema has no field for it, so this
  // also proves the type system forbids it, not just this test.
  function statusFromDecline(requestId: string, ts: string): Envelope {
    return { v: "0.1", type: "STATUS", request_id: requestId, ts, body: { state: "PASS" } };
  }
  function statusFromNoMatch(requestId: string, ts: string): Envelope {
    return { v: "0.1", type: "STATUS", request_id: requestId, ts, body: { state: "PASS" } };
  }

  it("produce deep-equal bodies", () => {
    const a = statusFromDecline(REQUEST_ID, TS);
    const b = statusFromNoMatch(REQUEST_ID, TS);
    expect(a.body).toEqual(b.body);
  });

  it("serialize byte-identically given the same request_id/ts", () => {
    const a = serializeEnvelope(statusFromDecline(REQUEST_ID, TS));
    const b = serializeEnvelope(statusFromNoMatch(REQUEST_ID, TS));
    expect(a).toBe(b);
  });

  it("serialization uses stable (sorted) key ordering regardless of construction order", () => {
    const constructedOneWay: Envelope = {
      v: "0.1",
      type: "STATUS",
      request_id: REQUEST_ID,
      ts: TS,
      body: { state: "PASS" },
    };
    const constructedOtherWay = {
      body: { state: "PASS" },
      ts: TS,
      request_id: REQUEST_ID,
      type: "STATUS",
      v: "0.1",
    } as unknown as Envelope;
    expect(serializeEnvelope(constructedOneWay)).toBe(serializeEnvelope(constructedOtherWay));
  });
});
