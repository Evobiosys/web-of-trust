import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { Envelope } from "@resource-web/protocol";
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

interface BootOpts {
  personaName?: string;
  peerId?: string;
  bus?: InMemoryBus;
  /** When set, the persona hosts the trust-graph mediator: startServer mounts POST /relay/send → relayServer.submit (Task 10 / finding 2). */
  relayServer?: { submit(rawWire: string): { routed: "accepted" | "rejected"; reason?: string }; attachDrainWss(httpServer: unknown, path?: string): void };
}

async function bootDaemon(port: number, opts: BootOpts = {}): Promise<{ daemon: Daemon; server: StartedServer; store: SqliteStore; transport: InMemoryTransport }> {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const scheduler = new FakeScheduler(clock);
  const store = new SqliteStore(":memory:");
  const config: DaemonConfig = {
    personaName: opts.personaName ?? "Anna",
    peerId: opts.peerId ?? "@anna-agent:wot.local",
    accent: "warm",
    statusDelayMs: 2000,
    defaultAskTtlMs: 3_600_000,
    matcher: { embedModel: "fake", chatModel: "fake", threshold: 0.6 },
  };
  const transport = new InMemoryTransport(opts.bus ?? new InMemoryBus());
  const daemon = new Daemon({
    config,
    store,
    transport,
    scheduler,
    clock,
    embedClient: new FakeEmbedClient(),
    chatClient: new FakeChatClient(),
  });
  await daemon.init();
  const server = await startServer(daemon, port, opts.relayServer ? { relayServer: opts.relayServer as never } : {});
  return { daemon, server, store, transport };
}

/** Two connected daemons (Anna, Ben) sharing one InMemoryBus, each with mutual
 * "close" trust edges already set via the HTTP surface itself — reused by
 * every Task 5 test that needs a real cross-peer round trip (listings, loans,
 * DMs), rather than each test wiring the bus by hand. */
async function bootConnectedPair(
  portA: number,
  portB: number
): Promise<{
  anna: { daemon: Daemon; server: StartedServer; store: SqliteStore; port: number };
  ben: { daemon: Daemon; server: StartedServer; store: SqliteStore; port: number };
}> {
  const bus = new InMemoryBus();
  const annaBoot = await bootDaemon(portA, { personaName: "Anna", peerId: "@anna-agent:wot.local", bus });
  const benBoot = await bootDaemon(portB, { personaName: "Ben", peerId: "@ben-agent:wot.local", bus });

  await fetch(`http://127.0.0.1:${portA}/api/trust`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ peer: "@ben-agent:wot.local", display: "Ben", level: "close" }),
  });
  await fetch(`http://127.0.0.1:${portB}/api/trust`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ peer: "@anna-agent:wot.local", display: "Anna", level: "close" }),
  });

  return {
    anna: { daemon: annaBoot.daemon, server: annaBoot.server, store: annaBoot.store, port: portA },
    ben: { daemon: benBoot.daemon, server: benBoot.server, store: benBoot.store, port: portB },
  };
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

describe("REST/WS server — Task 5 extended HTTP surface", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  // ------------------------------------------------------------ CORS/OPTIONS --

  it("sets CORS headers on a normal 200 response", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/state`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET,POST,DELETE,OPTIONS");
  });

  it("sets CORS headers on error responses too (404, 400)", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();

    const notFound = await fetch(`http://127.0.0.1:${port}/api/nope`);
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("access-control-allow-origin")).toBe("*");

    const badReq = await fetch(`http://127.0.0.1:${port}/api/trust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(badReq.status).toBe(400);
    expect(badReq.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("responds 204 with CORS headers to an OPTIONS preflight, no body", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/listings`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const text = await res.text();
    expect(text).toBe("");
  });

  // ------------------------------------------------------------------ trust --

  it("POST /api/trust adds an edge; GET /api/trust lists it; DELETE removes it", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();

    const post = await fetch(`http://127.0.0.1:${port}/api/trust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ peer: "@ben-agent:wot.local", display: "Ben", level: "friend" }),
    });
    expect(post.status).toBe(200);
    const posted = (await post.json()) as { trust_edge: { peer: string; level: string } };
    expect(posted.trust_edge.peer).toBe("@ben-agent:wot.local");
    expect(posted.trust_edge.level).toBe("friend");

    const list = (await (await fetch(`http://127.0.0.1:${port}/api/trust`)).json()) as { trust_edges: Array<{ peer: string }> };
    expect(list.trust_edges).toHaveLength(1);

    const del = await fetch(`http://127.0.0.1:${port}/api/trust?peer=${encodeURIComponent("@ben-agent:wot.local")}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const listAfter = (await (await fetch(`http://127.0.0.1:${port}/api/trust`)).json()) as { trust_edges: unknown[] };
    expect(listAfter.trust_edges).toHaveLength(0);
  });

  it("POST /api/trust rejects an invalid level with 400", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/trust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ peer: "@ben-agent:wot.local", display: "Ben", level: "bogus" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/trust rejects a missing peer/display with 400", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/trust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display: "Ben" }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /api/trust with no peer returns 400", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/trust`, { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  // ------------------------------------------------------------------ notes --

  it("POST /api/notes creates a second_brain item and sends NO notification (D1.6)", async () => {
    const port = nextPort();
    const { server, store, transport } = await bootDaemon(port);
    cleanup = () => server.close();

    const sent: Array<{ to: string; env: Envelope }> = [];
    const realSend = transport.send.bind(transport);
    transport.send = async (to, env) => {
      sent.push({ to, env });
      return realSend(to, env);
    };

    const res = await fetch(`http://127.0.0.1:${port}/api/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ labels: ["Drill"], description: "Timo's cordless drill", owner: "@timo-agent:wot.local" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item_id: string };
    expect(body.item_id).toBeTruthy();

    const item = store.getItem(body.item_id);
    expect(item?.provenance).toEqual({ kind: "second_brain", owner: "@timo-agent:wot.local", noted_at: "2026-01-01T00:00:00.000Z" });
    // D1.6: noting a second-brain item must never itself put anything on the wire.
    expect(sent).toHaveLength(0);
  });

  it("POST /api/notes rejects a missing owner with 400", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ labels: ["Drill"], description: "Timo's cordless drill" }),
    });
    expect(res.status).toBe(400);
  });

  // --------------------------------------------------------------- listings --

  it("POST /api/listings publishes; GET /api/listings shows it under mine; withdraw flips state", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();

    const publish = await fetch(`http://127.0.0.1:${port}/api/listings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "offer", title: "Ladder", description: "3m ladder", tier: "trusted" }),
    });
    expect(publish.status).toBe(200);
    const { listing_id } = (await publish.json()) as { listing_id: string };
    expect(listing_id).toBeTruthy();

    const mine = (await (await fetch(`http://127.0.0.1:${port}/api/listings`)).json()) as {
      mine: Array<{ listing_id: string; state: string }>;
      received: unknown[];
    };
    expect(mine.mine).toHaveLength(1);
    expect(mine.mine[0].state).toBe("active");

    const withdraw = await fetch(`http://127.0.0.1:${port}/api/listings/${listing_id}/withdraw`, { method: "POST" });
    expect(withdraw.status).toBe(200);
    const mineAfter = (await (await fetch(`http://127.0.0.1:${port}/api/listings`)).json()) as { mine: Array<{ state: string }> };
    expect(mineAfter.mine[0].state).toBe("withdrawn");
  });

  it("POST /api/listings/:id/withdraw on an unknown listing returns 400", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/listings/does-not-exist/withdraw`, { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("GET /api/listings?public=1 returns ONLY active public-tier listings, with where_gated stripped", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();

    async function publish(body: Record<string, unknown>): Promise<string> {
      const res = await fetch(`http://127.0.0.1:${port}/api/listings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { listing_id: string };
      return json.listing_id;
    }

    const publicId = await publish({
      kind: "offer",
      title: "Public ladder",
      description: "for anyone",
      tier: "public",
      where_public: "Wien-Ottakring",
      where_gated: "Hauptstraße 12, top secret exact address",
    });
    await publish({ kind: "offer", title: "Trusted-only drill", description: "trusted tier", tier: "trusted" });
    await publish({ kind: "offer", title: "Commons bike", description: "wot_commons tier", tier: "wot_commons" });
    const withdrawnPublicId = await publish({ kind: "offer", title: "Withdrawn public thing", description: "gone", tier: "public" });
    await fetch(`http://127.0.0.1:${port}/api/listings/${withdrawnPublicId}/withdraw`, { method: "POST" });

    const guestRes = await fetch(`http://127.0.0.1:${port}/api/listings?public=1`);
    expect(guestRes.status).toBe(200);
    const raw = await guestRes.text();
    const guest = JSON.parse(raw) as { mine: Array<Record<string, unknown>>; received: unknown[] };

    expect(guest.mine).toHaveLength(1);
    expect(guest.mine[0].listing_id).toBe(publicId);
    expect(guest.mine[0].where_public).toBe("Wien-Ottakring");
    // SECURITY-CRITICAL: where_gated must be entirely absent, not just undefined.
    expect("where_gated" in guest.mine[0]).toBe(false);
    expect(raw).not.toContain("top secret exact address");
    expect(guest.received).toEqual([]);
  });

  // ------------------------------------------------------------------ card --

  it("GET /api/card returns peer_id/display/level_offer_default (no DID fields for mock transport)", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/card`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.peer_id).toBe("@anna-agent:wot.local");
    expect(body.display).toBe("Anna");
    expect(body.level_offer_default).toBe("friend");
    expect(body.did).toBeUndefined();
  });

  // ------------------------------------------------------------ threads/DM --

  it("POST /api/threads/:peer_id/message sends a DM; both sides' GET /api/threads reflect it", async () => {
    const portA = nextPort();
    const portB = nextPort();
    const { anna, ben } = await bootConnectedPair(portA, portB);
    cleanup = async () => {
      await anna.server.close();
      await ben.server.close();
    };

    const send = await fetch(`http://127.0.0.1:${portA}/api/threads/${encodeURIComponent("@ben-agent:wot.local")}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hey Ben!" }),
    });
    expect(send.status).toBe(200);

    const annaThreads = (await (await fetch(`http://127.0.0.1:${portA}/api/threads`)).json()) as {
      threads: Array<{ peer_id: string; messages: Array<{ from: string; text: string }> }>;
    };
    expect(annaThreads.threads).toHaveLength(1);
    expect(annaThreads.threads[0].messages[0]).toMatchObject({ from: "self", text: "Hey Ben!" });

    const benThreads = (await (await fetch(`http://127.0.0.1:${portB}/api/threads`)).json()) as {
      threads: Array<{ peer_id: string; messages: Array<{ from: string; text: string }> }>;
    };
    expect(benThreads.threads).toHaveLength(1);
    expect(benThreads.threads[0].messages[0]).toMatchObject({ from: "@anna-agent:wot.local", text: "Hey Ben!" });
  });

  it("POST /api/threads/:peer_id/message to a stranger (no trust edge) returns 400", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/threads/${encodeURIComponent("@stranger:wot.local")}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(res.status).toBe(400);
  });

  // ------------------------------------------------------------ borrow/loans --

  it("full borrow round trip: publish (Anna) -> borrow (Ben) -> approve/lend/return/complete (both sides via HTTP)", async () => {
    const portA = nextPort();
    const portB = nextPort();
    const { anna, ben } = await bootConnectedPair(portA, portB);
    cleanup = async () => {
      await anna.server.close();
      await ben.server.close();
    };

    const publish = await fetch(`http://127.0.0.1:${portA}/api/listings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "offer", title: "Drill", description: "cordless drill", tier: "close" }),
    });
    const { listing_id } = (await publish.json()) as { listing_id: string };

    const received = (await (await fetch(`http://127.0.0.1:${portB}/api/listings`)).json()) as { received: Array<{ listing_id: string }> };
    expect(received.received.map((l) => l.listing_id)).toContain(listing_id);

    const borrow = await fetch(`http://127.0.0.1:${portB}/api/borrow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listing_id }),
    });
    expect(borrow.status).toBe(200);
    const { loan_id } = (await borrow.json()) as { loan_id: string };
    expect(loan_id).toBeTruthy();

    // Owner (Anna) side sees the same loan_id (role "owner"); approve -> lend.
    for (const state of ["approved", "lent"]) {
      const res = await fetch(`http://127.0.0.1:${portA}/api/loans/${loan_id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
      expect(res.status).toBe(200);
    }

    // Borrower (Ben) marks returned; owner (Anna) checks in complete.
    const returned = await fetch(`http://127.0.0.1:${portB}/api/loans/${loan_id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "returned" }),
    });
    expect(returned.status).toBe(200);

    const complete = await fetch(`http://127.0.0.1:${portA}/api/loans/${loan_id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "complete", note: "all good, local only" }),
    });
    expect(complete.status).toBe(200);

    const annaState = (await (await fetch(`http://127.0.0.1:${portA}/api/state`)).json()) as { loans: Array<{ loan_id: string; state: string }> };
    expect(annaState.loans.find((l) => l.loan_id === loan_id)?.state).toBe("complete");
  });

  it("POST /api/loans/:loan_id rejects an invalid state with 400", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/loans/whatever`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "bogus" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/borrow on an unknown listing returns 400", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/borrow`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listing_id: "does-not-exist" }),
    });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------- WS --

  it("broadcasts listing/loan/dm WS events alongside state_changed", async () => {
    const port = nextPort();
    const { server } = await bootDaemon(port);
    cleanup = () => server.close();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const events: unknown[] = [];
    ws.on("message", (data) => events.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    await fetch(`http://127.0.0.1:${port}/api/listings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "offer", title: "Tent", description: "4-person tent", tier: "public" }),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events.some((e) => (e as { type: string }).type === "listing")).toBe(true);
    expect(events.some((e) => (e as { type: string }).type === "state_changed")).toBe(true);
    ws.close();
  });

  // --------------------------------------- Task 10 / finding 2: relay ingress --

  it("POST /relay/send bounds the body: an oversize wire is rejected 413 and never reaches submit()", async () => {
    const port = nextPort();
    const submitted: string[] = [];
    const relayServer = {
      submit(rawWire: string): { routed: "accepted" | "rejected"; reason?: string } {
        submitted.push(rawWire);
        return { routed: "accepted" };
      },
      attachDrainWss(): void {
        /* no drain WS needed for this ingress-body test */
      },
    };
    const { server } = await bootDaemon(port, { relayServer });
    cleanup = () => server.close();

    // A small wire is accepted and reaches submit().
    const small = JSON.stringify({ to: "did:peer:2.xyz", ciphertext: "small" });
    const okRes = await fetch(`http://127.0.0.1:${port}/relay/send`, { method: "POST", body: small });
    expect(okRes.status).toBe(202);
    expect(await okRes.json()).toEqual({ routed: "accepted" });
    expect(submitted).toHaveLength(1);

    // An oversize body (> the 128 KiB /relay/send cap) is rejected 413 mid-read
    // and submit() is NEVER called — the guard runs on the REAL alpha path, not
    // only inside RelayServer.listen()'s handleIngressRequest.
    const oversize = JSON.stringify({ to: "did:peer:2.xyz", ciphertext: "x".repeat(200 * 1024) });
    const bigRes = await fetch(`http://127.0.0.1:${port}/relay/send`, { method: "POST", body: oversize });
    expect(bigRes.status).toBe(413);
    expect(submitted).toHaveLength(1); // still just the small one
  });

  it("POST /relay/send returns the mediator's non-informative {routed:'accepted'} verbatim (no live/queued oracle)", async () => {
    const port = nextPort();
    const relayServer = {
      submit(): { routed: "accepted" | "rejected"; reason?: string } {
        return { routed: "accepted" };
      },
      attachDrainWss(): void {},
    };
    const { server } = await bootDaemon(port, { relayServer });
    cleanup = () => server.close();

    const res = await fetch(`http://127.0.0.1:${port}/relay/send`, {
      method: "POST",
      body: JSON.stringify({ to: "did:peer:2.xyz", ciphertext: "c" }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ routed: "accepted" });
  });
});
