import { describe, expect, it } from "vitest";
import {
  anonymizedRevealDecision,
  outwardAnonymizedResponse,
  NOTHING_SHAREABLE_TEXT,
} from "./anonymity.js";

describe("anonymizedRevealDecision", () => {
  it("returns none for zero matches", () => {
    expect(anonymizedRevealDecision(0, 100)).toEqual({ kind: "none" });
  });

  it("suppresses below the default k of 3", () => {
    expect(anonymizedRevealDecision(1, 100)).toEqual({ kind: "suppressed", matchCount: 1 });
    expect(anonymizedRevealDecision(2, 100)).toEqual({ kind: "suppressed", matchCount: 2 });
  });

  it("anonymizes at k and above", () => {
    expect(anonymizedRevealDecision(3, 100)).toEqual({
      kind: "anonymized",
      matchCount: 3,
      totalCount: 100,
    });
  });

  it("respects a custom k", () => {
    expect(anonymizedRevealDecision(4, 10, 5).kind).toBe("suppressed");
    expect(anonymizedRevealDecision(5, 10, 5).kind).toBe("anonymized");
  });
});

describe("outwardAnonymizedResponse", () => {
  it("phrases the aggregate as 'N of M'", () => {
    const out = outwardAnonymizedResponse({ kind: "anonymized", matchCount: 3, totalCount: 100 });
    expect(out.text).toBe("3 of 100 people in this network match your request.");
    expect(out.matchCount).toBe(3);
  });

  it("keeps zero-match and suppressed responses byte-identical", () => {
    const none = outwardAnonymizedResponse({ kind: "none" });
    const suppressed = outwardAnonymizedResponse({ kind: "suppressed", matchCount: 2 });
    expect(suppressed).toEqual(none);
    expect(none.text).toBe(NOTHING_SHAREABLE_TEXT);
  });
});
