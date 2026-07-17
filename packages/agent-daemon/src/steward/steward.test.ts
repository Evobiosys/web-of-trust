import { describe, expect, it } from "vitest";
import { SqliteStore } from "../store/sqlite_store.js";
import { FakeClock } from "../clock.js";
import type { ChatClient } from "../matcher/clients.js";
import type { AskRecord } from "../store/types.js";
import { classifyAndRespond, ruleBasedClassify, type StewardDeps } from "./steward.js";

class ScriptedChatClient implements ChatClient {
  private calls = 0;
  constructor(private readonly responses: string[]) {}
  async chat(): Promise<string> {
    const r = this.responses[Math.min(this.calls, this.responses.length - 1)];
    this.calls += 1;
    return r;
  }
}

class UnreachableChatClient implements ChatClient {
  async chat(): Promise<string> {
    throw new Error("simulated: ollama unreachable");
  }
}

function makeDeps(overrides: Partial<StewardDeps> = {}): StewardDeps {
  const store = overrides.store ?? new SqliteStore(":memory:");
  const clock = overrides.clock ?? new FakeClock("2026-01-01T00:00:00.000Z");
  return {
    store,
    clock,
    chatClient: overrides.chatClient ?? new UnreachableChatClient(),
    chatModel: "fake-chat",
    sendAsk:
      overrides.sendAsk ??
      (async (text: string): Promise<AskRecord> => ({
        request_id: "11111111-1111-4111-8111-111111111111",
        text,
        created_at: clock.now().toISOString(),
        ttl_ms: 3_600_000,
        internal_state: "open",
        queried_count: 2,
        peers: [],
      })),
  };
}

describe("ruleBasedClassify", () => {
  it("classifies confirm words", () => {
    expect(ruleBasedClassify("yes")).toBe("confirm");
    expect(ruleBasedClassify("Ja, passt!")).toBe("confirm");
  });
  it("classifies ask markers", () => {
    expect(ruleBasedClassify("Hat wer einen Akkuschrauber?")).toBe("ask");
    expect(ruleBasedClassify("who has a ladder")).toBe("ask");
  });
  it("classifies capture markers", () => {
    expect(ruleBasedClassify("I have a Bosch cordless screwdriver I barely use")).toBe("capture");
  });
  it("falls back to other", () => {
    expect(ruleBasedClassify("Danke dir!")).toBe("other");
  });
});

describe("classifyAndRespond — capture -> confirm flow (confirm-before-save)", () => {
  it("does not persist an item on capture alone; persists only after confirm", async () => {
    const deps = makeDeps({ chatClient: new UnreachableChatClient() }); // forces rule-based fallback throughout
    const captureReply = await classifyAndRespond("I have a Bosch cordless screwdriver I barely use", deps);
    expect(captureReply.toLowerCase()).toContain("confirm");
    expect(deps.store.getItems()).toHaveLength(0); // not saved yet

    const confirmReply = await classifyAndRespond("yes", deps);
    expect(deps.store.getItems()).toHaveLength(1);
    expect(confirmReply).toContain("Added");
  });

  it("uses the LLM's structured extraction when available", async () => {
    const chat = new ScriptedChatClient([
      JSON.stringify({ kind: "capture" }),
      JSON.stringify({ labels: ["Bosch IXO", "cordless screwdriver"], description: "Barely used cordless screwdriver.", tags: ["tools"] }),
    ]);
    const deps = makeDeps({ chatClient: chat });
    const reply = await classifyAndRespond("Ich hab einen Bosch IXO Akkuschrauber, den ich kaum nutze.", deps);
    expect(reply).toContain("Bosch IXO");
    expect(deps.store.getLatestPendingCapture()?.item.tags).toEqual(["tools"]);
  });

  it("replies gracefully when there is nothing pending to confirm", async () => {
    const deps = makeDeps();
    const reply = await classifyAndRespond("yes", deps);
    expect(reply.toLowerCase()).toContain("nothing to confirm");
    expect(deps.store.getItems()).toHaveLength(0);
  });
});

describe("classifyAndRespond — ask", () => {
  it("fans out via sendAsk and reports the queried count", async () => {
    const deps = makeDeps();
    const reply = await classifyAndRespond("Hat wer in meiner Nähe einen Akkuschrauber?", deps);
    expect(reply).toBe("Asked 2 trusted people nearby. You'll hear back.");
  });
});

describe("classifyAndRespond — other", () => {
  it("gives a generic helpful reply", async () => {
    const deps = makeDeps();
    const reply = await classifyAndRespond("Danke dir!", deps);
    expect(reply.length).toBeGreaterThan(0);
  });
});
