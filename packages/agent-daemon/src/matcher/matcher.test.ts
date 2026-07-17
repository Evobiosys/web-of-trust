import { describe, expect, it, beforeEach } from "vitest";
import { ItemSchema, type Item } from "@resource-web/protocol";
import { SqliteStore } from "../store/sqlite_store.js";
import type { ChatClient, EmbedClient } from "./clients.js";
import { FixtureEmbedClient, loadEmbeddingFixture } from "./fixture_embed_client.js";
import { matchRequestToItems, type MatcherConfig } from "./matcher.js";

const fixture = loadEmbeddingFixture();

function item(overrides: Partial<Item> & { id: string; labels: string[]; description: string }): Item {
  return ItemSchema.parse({
    tags: [],
    provenance: { kind: "self" },
    policy: {},
    ...overrides,
  });
}

const screwdriver = item({ id: "screwdriver", labels: ["Bosch IXO cordless screwdriver", "Akkuschrauber"], description: "Small cordless screwdriver, barely used." });
const tent = item({ id: "tent", labels: ["2p camping tent", "Zelt"], description: "Two-person tent, waterproof, easy setup." });
const ladder = item({ id: "ladder", labels: ["3m ladder", "Leiter"], description: "Aluminium 3-metre ladder." });
const benItems = [screwdriver, tent, ladder];

const QUERY_AKKUSCHRAUBER = "Hat wer in meiner Nähe einen Akkuschrauber?";
const QUERY_SUP = "Hat wer ein Stand-Up-Paddle?";
const QUERY_LADDER_EN = "Does anyone have a ladder I could borrow?";

class RejectingEmbedClient implements EmbedClient {
  async embed(): Promise<number[][]> {
    throw new Error("simulated: ollama /api/embed unreachable");
  }
}

class ScriptedChatClient implements ChatClient {
  private calls = 0;
  constructor(private readonly responses: string[]) {}
  async chat(): Promise<string> {
    const response = this.responses[Math.min(this.calls, this.responses.length - 1)];
    this.calls += 1;
    return response;
  }
  get callCount() {
    return this.calls;
  }
}

class RejectingChatClient implements ChatClient {
  async chat(): Promise<string> {
    throw new Error("simulated: ollama /api/chat unreachable");
  }
}

const config: MatcherConfig = { embedModel: fixture.model, chatModel: "qwen3:4b", threshold: 0.6 };

describe("matchRequestToItems", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(":memory:");
  });

  it("stage 1+2: embedding shortlist feeds LLM adjudication, which confirms the match", async () => {
    const chat = new ScriptedChatClient([
      JSON.stringify({ match: true, item_id: "screwdriver", confidence: 0.93, reason: "Akkuschrauber is the German term for cordless screwdriver." }),
    ]);
    const result = await matchRequestToItems(QUERY_AKKUSCHRAUBER, benItems, {
      store,
      embedClient: new FixtureEmbedClient(fixture),
      chatClient: chat,
      config,
    });
    expect(result.matched).toBe(true);
    expect(result.item_id).toBe("screwdriver");
    expect(result.stage).toBe("embedding_llm");
    // every candidate's embedding score was logged (I6), not just the winner
    expect(result.scores.filter((s) => s.stage === "embedding_shortlist_candidate")).toHaveLength(3);
  });

  it("real recorded embeddings: only the screwdriver crosses the 0.60 threshold for the Akkuschrauber query", async () => {
    const result = await matchRequestToItems(QUERY_AKKUSCHRAUBER, benItems, {
      store,
      embedClient: new FixtureEmbedClient(fixture),
      chatClient: new RejectingChatClient(),
      config,
    });
    // LLM unreachable -> trust the shortlist; shortlist has exactly one candidate.
    expect(result.matched).toBe(true);
    expect(result.item_id).toBe("screwdriver");
    expect(result.stage).toBe("embedding_shortlist");
  });

  it("negative control: unrelated query crosses no item's embedding threshold -> no_match, no LLM call", async () => {
    const chat = new ScriptedChatClient([JSON.stringify({ match: true, item_id: "tent", confidence: 0.5, reason: "should not be reached" })]);
    const result = await matchRequestToItems(QUERY_SUP, benItems, {
      store,
      embedClient: new FixtureEmbedClient(fixture),
      chatClient: chat,
      config,
    });
    expect(result.matched).toBe(false);
    expect(result.stage).toBe("no_match");
    expect(chat.callCount).toBe(0);
  });

  it("stage 2 fallback: non-JSON LLM response is retried once, then the shortlist is trusted", async () => {
    const chat = new ScriptedChatClient(["not json at all", "still not json"]);
    const result = await matchRequestToItems(QUERY_AKKUSCHRAUBER, benItems, {
      store,
      embedClient: new FixtureEmbedClient(fixture),
      chatClient: chat,
      config,
    });
    expect(chat.callCount).toBe(2);
    expect(result.matched).toBe(true);
    expect(result.item_id).toBe("screwdriver");
    expect(result.stage).toBe("embedding_shortlist");
  });

  it("stage 3: embedding stage unreachable falls through to keyword/synonym fallback", async () => {
    const result = await matchRequestToItems(QUERY_LADDER_EN, benItems, {
      store,
      embedClient: new RejectingEmbedClient(),
      chatClient: new RejectingChatClient(),
      config,
    });
    expect(result.matched).toBe(true);
    expect(result.item_id).toBe("ladder");
    expect(result.stage).toBe("keyword");
  });

  it("stage 3 negative control: keyword fallback also correctly finds nothing for the SUP query", async () => {
    const result = await matchRequestToItems(QUERY_SUP, benItems, {
      store,
      embedClient: new RejectingEmbedClient(),
      chatClient: new RejectingChatClient(),
      config,
    });
    expect(result.matched).toBe(false);
    expect(result.stage).toBe("no_match");
  });

  it("caches item embeddings in the store so a second call does not re-embed items", async () => {
    let embedCalls = 0;
    const countingClient: EmbedClient = {
      embed: async (model, input) => {
        embedCalls += 1;
        return new FixtureEmbedClient(fixture).embed(model, input);
      },
    };
    await matchRequestToItems(QUERY_AKKUSCHRAUBER, benItems, { store, embedClient: countingClient, chatClient: new RejectingChatClient(), config });
    const firstCallCount = embedCalls;
    await matchRequestToItems(QUERY_AKKUSCHRAUBER, benItems, { store, embedClient: countingClient, chatClient: new RejectingChatClient(), config });
    const secondCallCount = embedCalls - firstCallCount;
    // second run re-embeds only the query (1 call), not all 3 items again.
    expect(secondCallCount).toBe(1);
    expect(store.getItemEmbedding("screwdriver", config.embedModel)).toBeDefined();
  });

  it("returns no_match immediately when there are no items to match against", async () => {
    const result = await matchRequestToItems(QUERY_AKKUSCHRAUBER, [], {
      store,
      embedClient: new FixtureEmbedClient(fixture),
      chatClient: new RejectingChatClient(),
      config,
    });
    expect(result.matched).toBe(false);
    expect(result.stage).toBe("no_match");
  });
});
