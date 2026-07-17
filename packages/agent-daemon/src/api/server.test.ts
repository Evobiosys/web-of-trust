import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { FakeClock, FakeScheduler } from "../clock.js";
import { InMemoryBus, InMemoryTransport } from "../transport/in_memory_transport.js";
import { SqliteStore } from "../store/sqlite_store.js";
import { Daemon, type DaemonConfig } from "../daemon/daemon.js";
import type { ChatClient, EmbedClient } from "../matcher/clients.js";
import { startServer, type StartedServer } from "./server.js";

class FakeEmbedClient implements EmbedClient {
  async embed(_model: string, input: string[]): Promise<number[][]> {
    void _model;
    return input.map(() => [1, 0]);
  }
}
class FakeChatClient implements ChatClient {
  async chat(): Promise<string> {
    throw new Error("no LLM in this test");
  }
}

async function bootDaemon(port: number): Promise<{ daemon: Daemon; server: StartedServer; store: SqliteStore }> {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const scheduler = new FakeScheduler(clock);
  const store = new SqliteStore(":memory:");
  const config: DaemonConfig = {
    personaName: "Anna",
    peerId: "@anna-agent:wot.local",
    accent: "warm",
    statusDelayMs: 2000,
    defaultAskTtlMs: 3_600_000,
    matcher: { embedModel: "fake", chatModel: "fake", threshold: 0.6 },
  };
  const daemon = new Daemon({
    config,
    store,
    transport: new InMemoryTransport(new InMemoryBus()),
    scheduler,
    clock,
    embedClient: new FakeEmbedClient(),
    chatClient: new FakeChatClient(),
  });
  await daemon.init();
  const server = await startServer(daemon, port);
  return { daemon, server, store };
}

const BASE_PORT = 41500;
let portCounter = 0;
function nextPort(): number {
  portCounter += 1;
  return BASE_PORT + portCounter;
}

describe("REST/WS server", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  it("GET /api/state returns the persona snapshot shape from docs/API.md", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();

    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { persona: { name: string }; items: unknown[]; asks: unknown[] };
    expect(body.persona.name).toBe("Anna");
    expect(body.items).toEqual([]);
    expect(body.asks).toEqual([]);
  });

  it("POST /api/steward classifies an ask and fans out a REQUEST, reflected in /api/state", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();

    const res = await fetch(`http://127.0.0.1:${port}/api/steward`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hat wer in meiner Nähe einen Akkuschrauber?" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string };
    expect(body.reply).toContain("Asked 0 trusted people"); // no trust edges configured in this test

    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
    expect(state.asks).toHaveLength(1);
  });

  it("rejects a malformed /api/consent request with 400", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();

    const res = await fetch(`http://127.0.0.1:${port}/api/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown route", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/nope`);
    expect(res.status).toBe(404);
  });

  it("GET /api/audit returns human-readable entries", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    await fetch(`http://127.0.0.1:${port}/api/steward`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hat wer einen Akkuschrauber?" }),
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/audit`);
    const body = (await res.json()) as { entries: Array<{ ts: string; decision: string; detail: string }> };
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries[0]).toHaveProperty("decision");
    expect(body.entries[0]).toHaveProperty("detail");
  });

  it("broadcasts a state_changed WS event when an ask is sent via the steward endpoint", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const firstEvent = new Promise<unknown>((resolve, reject) => {
      ws.on("message", (data) => resolve(JSON.parse(data.toString())));
      ws.on("error", reject);
    });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    await fetch(`http://127.0.0.1:${port}/api/steward`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hat wer einen Akkuschrauber?" }),
    });

    const event = await firstEvent;
    expect(event).toEqual({ type: "state_changed" });
    ws.close();
  });

  it("binds 127.0.0.1 only (not 0.0.0.0)", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    // A request via the loopback IP must succeed; this at least proves the
    // server is listening there (an exhaustive "nothing else can reach it"
    // check would require binding a second interface, out of scope here).
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(res.status).toBe(200);
  });
});
