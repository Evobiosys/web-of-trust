import { describe, expect, it } from "vitest";
import { KeywordContactMatcher, LlmContactMatcher } from "./contact_matcher.js";
import type { ChatClient } from "./contact_matcher.js";
import type { ContactRecord } from "./types.js";

const contacts: ContactRecord[] = [
  { id: "ana", name: "Ana", tags: ["permaculture", "vienna"], notes: "runs a garden collective" },
  { id: "ben", name: "Ben", tags: ["crypto", "celo"], notes: "regenerative finance" },
  { id: "cyn", name: "Cyn", tags: ["housing", "sf"], notes: "co-living steward" },
];

describe("KeywordContactMatcher", () => {
  it("matches on tag and note tokens, ignoring stopwords", async () => {
    const results = await new KeywordContactMatcher().match(
      "someone who knows permaculture in Vienna",
      contacts,
    );
    expect(results.map((r) => r.contact_id)).toEqual(["ana"]);
    expect(results[0]!.reason).toContain("permaculture");
  });

  it("returns empty for no overlap", async () => {
    expect(await new KeywordContactMatcher().match("quantum physics", contacts)).toEqual([]);
  });
});

describe("LlmContactMatcher", () => {
  it("parses strict-JSON replies and drops unknown ids", async () => {
    const chatClient: ChatClient = {
      chat: async () => '{"matches":[{"contact_id":"ben","reason":"celo work"},{"contact_id":"ghost"}]}',
    };
    const matcher = new LlmContactMatcher(chatClient, "m", new KeywordContactMatcher());
    const results = await matcher.match("fair crypto currency people", contacts);
    expect(results).toEqual([{ contact_id: "ben", score: 1, reason: "celo work" }]);
  });

  it("falls back to keywords when the LLM is unreachable", async () => {
    const chatClient: ChatClient = {
      chat: async () => {
        throw new Error("connection refused");
      },
    };
    const matcher = new LlmContactMatcher(chatClient, "m", new KeywordContactMatcher());
    const results = await matcher.match("permaculture intro", contacts);
    expect(results.map((r) => r.contact_id)).toEqual(["ana"]);
  });
});
