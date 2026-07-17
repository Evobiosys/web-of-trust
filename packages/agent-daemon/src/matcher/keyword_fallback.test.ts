import { describe, expect, it } from "vitest";
import { keywordMatch, normalizeText } from "./keyword_fallback.js";

const items = [
  { id: "screwdriver", labels: ["Bosch IXO cordless screwdriver", "Akkuschrauber"], description: "Small cordless screwdriver, barely used.", tags: ["tools"] },
  { id: "tent", labels: ["2p camping tent", "Zelt"], description: "Two-person tent, waterproof.", tags: ["outdoor"] },
  { id: "ladder", labels: ["3m ladder", "Leiter"], description: "Aluminium 3-metre ladder.", tags: ["tools"] },
];

describe("normalizeText", () => {
  it("lowercases, strips diacritics and punctuation, collapses whitespace", () => {
    expect(normalizeText("Hat wer einen Akkuschrauber??")).toBe("hat wer einen akkuschrauber");
    expect(normalizeText("Stand-Up-Paddle")).toBe("stand-up-paddle");
  });
});

describe("keywordMatch", () => {
  it("matches a German query to an English-labelled item via the synonym table", () => {
    const results = keywordMatch("Hat wer einen Akkuschrauber?", items);
    expect(results[0]?.item_id).toBe("screwdriver");
    expect(results[0]?.matchedConcepts).toContain("akkuschrauber");
  });

  it("matches an English query to a German-labelled item via the synonym table", () => {
    const results = keywordMatch("Does anyone have a ladder I could borrow?", items);
    expect(results[0]?.item_id).toBe("ladder");
  });

  it("returns no results for an unrelated query (negative control)", () => {
    const results = keywordMatch("Hat wer ein Stand-Up-Paddle?", items);
    expect(results).toEqual([]);
  });

  it("ranks a stronger concept+token overlap above a weaker one", () => {
    const results = keywordMatch("cordless screwdriver drill", items);
    expect(results[0]?.item_id).toBe("screwdriver");
  });
});
