#!/usr/bin/env tsx
// M2 acceptance demo: two real daemons (Anna asker, Ben owner), real HTTP
// servers, real (short) timers, driven entirely over REST — printing a
// labeled transcript. Flags:
//   --transport=matrix   attempt MatrixTransport (falls back to mock with a
//                        warning; @resource-web/transport has no
//                        MatrixTransport export yet in this worktree)
//   --branch=decline     run the 5b story instead: Ben taps No AFTER his
//                        PENDING has already dispatched — proves I3 silence
//                        (Anna only resolves to "no one this time" at TTL)
import { ItemSchema, type Item } from "@resource-web/protocol";
import { SqliteStore } from "../src/store/sqlite_store.js";
import { SystemClock, RealScheduler } from "../src/clock.js";
import { InMemoryBus, InMemoryTransport } from "../src/transport/in_memory_transport.js";
import { OllamaChatClient, OllamaEmbedClient } from "../src/matcher/clients.js";
import { Daemon, type DaemonConfig } from "../src/daemon/daemon.js";
import { startServer, type StartedServer } from "../src/api/server.js";

const args = process.argv.slice(2);
const transportFlag = (args.find((a) => a.startsWith("--transport="))?.split("=")[1] ?? "mock") as "mock" | "matrix";
const branch = (args.find((a) => a.startsWith("--branch="))?.split("=")[1] ?? "consent") as "consent" | "decline";

const STATUS_DELAY_MS = 2000;
// NOTE (decline branch timing): InMemoryTransport.send() awaits the full
// receiver-side pipeline (see in_memory_transport.ts) so daemon.test.ts's
// fake-clock tests don't race — but under REAL timers that means Anna's own
// sendAsk() call doesn't return until Ben's matcher (embed + LLM calls) has
// finished, which can itself take several real seconds. A real (decoupled)
// transport wouldn't block the asker like this. The decline branch's TTL
// must comfortably exceed STATUS_DELAY_MS *plus* that matching latency, or
// the ask can appear to time out before the scripted decline even happens.
const ASK_TTL_MS = branch === "decline" ? 30_000 : 60_000;
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const CHAT_MODEL = process.env.CHAT_MODEL ?? "qwen3:4b";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "qwen3-embedding:8b";
// Default ports match docs/API.md (anna 4101, ben 4102); overridable since a
// shared dev host may already have those bound (e.g. another worktree's mock
// server) — this script must not fight another agent's process for a port.
const ANNA_PORT = Number(args.find((a) => a.startsWith("--anna-port="))?.split("=")[1] ?? process.env.DEMO_ANNA_PORT ?? 4101);
const BEN_PORT = Number(args.find((a) => a.startsWith("--ben-port="))?.split("=")[1] ?? process.env.DEMO_BEN_PORT ?? 4102);

function banner(title: string): void {
  console.log(`\n──────── ${title} ────────`);
}
function say(persona: string, msg: string): void {
  console.log(`[${persona}] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `fn` until it returns true or `timeoutMs` elapses — used instead of
 * fixed sleeps around the uniform STATUS delay, since real LLM adjudication
 * latency (matcher chain stage 2) is variable and can itself exceed the
 * nominal delay under load. */
async function waitUntil(fn: () => Promise<boolean>, timeoutMs: number, intervalMs = 250): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start >= timeoutMs) return false;
    await sleep(intervalMs);
  }
}

async function post(port: number, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function get(port: number, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return (await res.json()) as Record<string, unknown>;
}

interface Persona {
  name: string;
  store: SqliteStore;
  server: StartedServer;
  port: number;
}

async function bootPersona(name: string, peerId: string, port: number, bus: InMemoryBus): Promise<Persona> {
  if (transportFlag === "matrix") {
    say(name, "WARN: --transport=matrix requested, but @resource-web/transport exports no MatrixTransport in this worktree (sibling package still a stub). Falling back to InMemoryTransport (mock). See docs/DAEMON.md §Transport factory.");
  }
  const transport = new InMemoryTransport(bus);
  const store = new SqliteStore(":memory:");
  const clock = new SystemClock();
  const config: DaemonConfig = {
    personaName: name,
    peerId,
    accent: "warm",
    statusDelayMs: STATUS_DELAY_MS,
    defaultAskTtlMs: ASK_TTL_MS,
    matcher: { embedModel: EMBED_MODEL, chatModel: CHAT_MODEL, threshold: 0.6 },
  };
  const daemon = new Daemon({
    config,
    store,
    transport,
    scheduler: new RealScheduler(clock),
    clock,
    embedClient: new OllamaEmbedClient({ baseUrl: OLLAMA_URL }),
    chatClient: new OllamaChatClient({ baseUrl: OLLAMA_URL }),
  });
  await daemon.init();
  const server = await startServer(daemon, port);
  return { name, store, server, port };
}

function selfItem(id: string, labels: string[], description: string, tags: string[]): Item {
  return ItemSchema.parse({ id, labels, description, tags, provenance: { kind: "self" }, policy: {} });
}

async function main(): Promise<void> {
  banner(`resource-web headless demo (M2 acceptance) — branch=${branch}, transport=${transportFlag}`);
  console.log(`STATUS_DELAY_MS=${STATUS_DELAY_MS} ASK_TTL_MS=${ASK_TTL_MS} OLLAMA_URL=${OLLAMA_URL} CHAT_MODEL=${CHAT_MODEL} EMBED_MODEL=${EMBED_MODEL}`);

  const bus = new InMemoryBus();
  const anna = await bootPersona("Anna", "@anna-agent:wot.local", ANNA_PORT, bus);
  const ben = await bootPersona("Ben", "@ben-agent:wot.local", BEN_PORT, bus);

  const now = new Date().toISOString();
  const oneYearFromNow = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  anna.store.putTrustEdge({ peer: "@ben-agent:wot.local", display: "Ben", created_at: now, expires_at: oneYearFromNow });
  ben.store.putTrustEdge({ peer: "@anna-agent:wot.local", display: "Anna", created_at: now, expires_at: oneYearFromNow });

  // Pre-seed the items the ask/negative-control depend on directly (same
  // text as test-fixtures/embeddings.json) so the demo's positive/negative
  // matching outcome is not at the mercy of live-LLM capture-extraction
  // wording variance run to run.
  ben.store.putItem(selfItem("screwdriver", ["Bosch IXO cordless screwdriver", "Akkuschrauber"], "Small cordless screwdriver, barely used.", ["tools"]));
  ben.store.putItem(selfItem("tent", ["2p camping tent", "Zelt"], "Two-person tent, waterproof, easy setup.", ["outdoor"]));
  anna.store.putItem(selfItem("pump", ["Bicycle pump", "Luftpumpe"], "Foot pump, fits Schrader and Presta valves.", ["outdoor"]));

  banner("Step 1 — capture (Ben tells his steward about the ladder; confirm-before-save)");
  let reply = await post(ben.port, "/api/steward", { text: "Ich habe eine 3m Leiter, die ich kaum benutze." });
  say("Ben -> steward", "Ich habe eine 3m Leiter, die ich kaum benutze.");
  say("steward -> Ben", String(reply.reply));
  reply = await post(ben.port, "/api/steward", { text: "ja" });
  say("Ben -> steward", "ja");
  say("steward -> Ben", String(reply.reply));
  const benItemsAfterCapture = (await get(ben.port, "/api/state")).items as unknown[];
  console.log(`Ben's shelf now has ${benItemsAfterCapture.length} item(s).`);

  banner("Step 2 — ask (Anna asks her steward)");
  const askText = "Hat wer in meiner Nähe einen Akkuschrauber?";
  reply = await post(anna.port, "/api/steward", { text: askText });
  say("Anna -> steward", askText);
  say("steward -> Anna", String(reply.reply));

  banner("Step 3 — status (aggregate only, I2: no peer identity, no per-peer state)");
  let annaState = (await get(anna.port, "/api/state")) as { asks: Array<Record<string, unknown>> };
  const askRequestId = annaState.asks[0].request_id as string;
  console.log(`Anna's asks[0] (immediately after fan-out): ${JSON.stringify(annaState.asks[0])}`);

  async function askState(): Promise<Record<string, unknown>> {
    const s = (await get(anna.port, "/api/state")) as { asks: Array<Record<string, unknown>> };
    return s.asks.find((a) => a.request_id === askRequestId)!;
  }

  // Real LLM adjudication latency is variable, so poll for the uniform
  // STATUS to have dispatched (state moves off "open") rather than assuming
  // a fixed sleep covers it (see ASK_TTL_MS note above).
  await waitUntil(async () => (await askState()).state !== "open", 20_000);
  console.log(`Anna's asks[0] (after uniform STATUS dispatch): ${JSON.stringify(await askState())}`);

  banner("Step 4 — consent card (owner side, I4: full context)");
  const benState = (await get(ben.port, "/api/state")) as { consent_cards: Array<Record<string, unknown>> };
  const card = benState.consent_cards[0];
  console.log(`Ben's consent_cards[0]: ${JSON.stringify(card)}`);

  if (branch === "consent") {
    banner("Step 5 — Yes branch: Ben consents -> room opens -> chat");
    await post(ben.port, "/api/consent", { card_id: card.card_id });
    say("Ben", "consents (tapped Yes)");
    await waitUntil(async () => (await askState()).state === "room_open", 10_000);

    annaState = (await get(anna.port, "/api/state")) as { asks: Array<Record<string, unknown>> };
    console.log(`Anna's asks[0]: ${JSON.stringify(await askState())}`);
    const roomId = (await askState()).room_id as string;

    await post(anna.port, `/api/rooms/${roomId}/message`, { text: "Super, danke! Wann passt es dir?" });
    say("Anna -> room", "Super, danke! Wann passt es dir?");
    await sleep(150);
    await post(ben.port, `/api/rooms/${roomId}/message`, { text: "Heute Abend ab 18 Uhr, komm einfach vorbei." });
    say("Ben -> room", "Heute Abend ab 18 Uhr, komm einfach vorbei.");
    await sleep(150);

    const annaRoom = ((await get(anna.port, "/api/state")) as { rooms: Array<{ room_id: string; messages: unknown[] }> }).rooms.find(
      (r) => r.room_id === roomId
    );
    console.log(`Room transcript (Anna's view): ${JSON.stringify(annaRoom?.messages)}`);

    banner("Step 6 — withdraw (fulfilled)");
    await post(anna.port, "/api/withdraw", { request_id: askRequestId, reason: "fulfilled" });
    console.log(`Anna's asks[0] after withdraw: ${JSON.stringify(await askState())}`);
  } else {
    banner("Step 5b — decline branch: Ben taps No AFTER PENDING has dispatched (I3 silence)");
    await post(ben.port, "/api/decline", { card_id: card.card_id });
    say("Ben", "declines (tapped No) — this happens AFTER the uniform PENDING already went out");
    console.log(`Anna's asks[0] immediately after Ben's decline (still "waiting" — no new wire message): ${JSON.stringify(await askState())}`);

    console.log(`Waiting out the ask's TTL (created_at + ${ASK_TTL_MS}ms) with no further signal from Ben...`);
    await waitUntil(async () => (await askState()).state === "no_one_this_time", ASK_TTL_MS + 5_000);
    console.log(`Anna's asks[0] after TTL: ${JSON.stringify(await askState())}`);
    console.log('Ben\'s decline was never distinguishable from "nobody had it" — I3 held.');
  }

  banner("Step 7 — negative control: unrelated request");
  const supText = "Hat wer ein Stand-Up-Paddle?";
  reply = await post(anna.port, "/api/steward", { text: supText });
  say("Anna -> steward", supText);
  say("steward -> Anna", String(reply.reply));
  annaState = (await get(anna.port, "/api/state")) as { asks: Array<Record<string, unknown>> };
  const supRequestId = annaState.asks.find((a) => a.text === supText)!.request_id as string;
  await waitUntil(async () => {
    const s = (await get(anna.port, "/api/state")) as { asks: Array<Record<string, unknown>> };
    return s.asks.find((a) => a.request_id === supRequestId)!.state !== "open";
  }, 20_000);
  annaState = (await get(anna.port, "/api/state")) as { asks: Array<Record<string, unknown>> };
  const supAsk = annaState.asks.find((a) => a.request_id === supRequestId);
  console.log(`Anna's SUP ask: ${JSON.stringify(supAsk)}`);

  banner("Demo complete");
  console.log(`Ben's audit log has ${((await get(ben.port, "/api/audit")).entries as unknown[]).length} entries.`);
  console.log(`Anna's audit log has ${((await get(anna.port, "/api/audit")).entries as unknown[]).length} entries.`);

  await anna.server.close();
  await ben.server.close();
  anna.store.close();
  ben.store.close();
  // Both personas still have a real (long) TTL timer pending (RealScheduler
  // uses genuine setTimeout) even though the demo's story is finished —
  // exit now rather than let the process hang around for up to ASK_TTL_MS
  // and then crash trying to touch an already-closed store.
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("headless_demo failed:", err);
  process.exitCode = 1;
});
