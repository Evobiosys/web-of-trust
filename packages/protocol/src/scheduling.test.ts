import { describe, it, expect } from "vitest";
import { statusDispatchAt } from "./scheduling.js";

describe("statusDispatchAt (I3: uniform reply schedule, no jitter)", () => {
  it("defaults to a 30s delay", () => {
    const received = new Date("2026-01-01T00:00:00.000Z");
    expect(statusDispatchAt(received)).toBe("2026-01-01T00:00:30.000Z");
  });

  it("accepts an explicit delayMs override", () => {
    const received = new Date("2026-01-01T00:00:00.000Z");
    expect(statusDispatchAt(received, 5_000)).toBe("2026-01-01T00:00:05.000Z");
  });

  it("accepts an ISO string as receivedAt", () => {
    expect(statusDispatchAt("2026-01-01T00:00:00.000Z", 1_000)).toBe("2026-01-01T00:00:01.000Z");
  });

  it("is deterministic: same input always yields the same output (no jitter)", () => {
    const received = "2026-06-15T08:30:00.000Z";
    const a = statusDispatchAt(received);
    const b = statusDispatchAt(received);
    expect(a).toBe(b);
  });
});
