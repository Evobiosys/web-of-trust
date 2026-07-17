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
