import { describe, it, expect } from "vitest";
import { DecisionLogEntrySchema, type DecisionLogEntry } from "./decision-log.js";

describe("DecisionLogEntrySchema (I6 auditability)", () => {
  const REQUEST_ID = "5f1e5c2a-9d3e-4a2b-8f1a-1e2d3c4b5a6f";

  it("parses a minimal entry", () => {
    const entry: DecisionLogEntry = DecisionLogEntrySchema.parse({
      ts: "2026-01-01T00:00:00.000Z",
      request_id: REQUEST_ID,
      actor: "owner",
      action: "status_pass",
    });
    expect(entry.actor).toBe("owner");
  });

  it("accepts an optional human-readable reason", () => {
    const entry = DecisionLogEntrySchema.parse({
      ts: "2026-01-01T00:00:00.000Z",
      request_id: REQUEST_ID,
      actor: "owner",
      action: "declined",
      reason: "item already lent out",
    });
    expect(entry.reason).toBe("item already lent out");
  });

  it("rejects an unknown actor", () => {
    expect(() =>
      DecisionLogEntrySchema.parse({
        ts: "2026-01-01T00:00:00.000Z",
        request_id: REQUEST_ID,
        actor: "bystander",
        action: "declined",
      })
    ).toThrow();
  });

  it("rejects unknown keys (strict)", () => {
    expect(() =>
      DecisionLogEntrySchema.parse({
        ts: "2026-01-01T00:00:00.000Z",
        request_id: REQUEST_ID,
        actor: "asker",
        action: "sent_request",
        extra: true,
      })
    ).toThrow();
  });
});
