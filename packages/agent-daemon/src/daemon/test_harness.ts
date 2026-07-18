// Shared two-daemon test harness (Anna asker, Ben owner) — used by every
// lifecycle test that needs real (fake-clock) timing across two in-process
// Daemons wired over one InMemoryBus. Not exported from the package's public
// surface; test-only.
import { TrustEdgeSchema, type Envelope } from "@resource-web/protocol";
import { FakeClock, FakeScheduler } from "../clock.js";
import { InMemoryBus, InMemoryTransport, type RoomMessage } from "../transport/in_memory_transport.js";
import { SqliteStore } from "../store/sqlite_store.js";
import type { ChatClient, EmbedClient } from "../matcher/clients.js";
import { Daemon, type DaemonConfig } from "./daemon.js";

export interface SentEnvelope {
  fromPersona: string;
  to: string;
  env: Envelope;
}

export interface SentRoomMessage {
  fromPersona: string;
  msg: RoomMessage;
}

/** Wraps an InMemoryTransport to record every outbound envelope/room-message for assertions. */
class RecordingTransport {
  constructor(
    private readonly inner: InMemoryTransport,
    private readonly personaName: string,
    private readonly envelopeLog: SentEnvelope[],
    private readonly roomMessageLog: SentRoomMessage[]
  ) {}

  init = (cfg: Parameters<InMemoryTransport["init"]>[0]) => this.inner.init(cfg);
  onEnvelope = (cb: Parameters<InMemoryTransport["onEnvelope"]>[0]) => this.inner.onEnvelope(cb);
  onRoomMessage = (cb: Parameters<InMemoryTransport["onRoomMessage"]>[0]) => this.inner.onRoomMessage(cb);
  createSharedRoom = (...args: Parameters<InMemoryTransport["createSharedRoom"]>) => this.inner.createSharedRoom(...args);

  send = async (peer: string, env: Envelope) => {
    this.envelopeLog.push({ fromPersona: this.personaName, to: peer, env });
    return this.inner.send(peer, env);
  };

  sendRoomMessage = async (msg: RoomMessage) => {
    this.roomMessageLog.push({ fromPersona: this.personaName, msg });
    return this.inner.sendRoomMessage(msg);
  };
}

// Deterministic, concept-aware fake embeddings (NOT the real matcher — that's
// covered offline against recorded ollama vectors in matcher.test.ts). Gives
// daemon-level lifecycle tests control over which item matches which query
// without depending on the network: texts map to a one-hot "concept" vector,
// so cosine similarity is 1 within a concept and 0 across concepts, exactly
// like a well-separated real embedding space would behave for these fixtures.
const CONCEPT_KEYWORDS: Record<string, string[]> = {
  screwdriver: ["screwdriver", "akkuschrauber", "schraubenzieher", "bohrmaschine", "drill"],
  tent: ["tent", "zelt"],
  ladder: ["ladder", "leiter"],
  pump: ["pump", "luftpumpe"],
  sup: ["stand-up-paddle", "stand up paddle", "sup", "paddleboard", "paddle board"],
};
const CONCEPTS = Object.keys(CONCEPT_KEYWORDS);

function conceptVector(text: string): number[] {
  const lower = text.toLowerCase();
  const dims = CONCEPTS.map((concept) => (CONCEPT_KEYWORDS[concept].some((k) => lower.includes(k)) ? 1 : 0));
  const other = dims.every((d) => d === 0) ? 1 : 0;
  return [...dims, other];
}

export class FakeEmbedClient implements EmbedClient {
  async embed(_model: string, input: string[]): Promise<number[][]> {
    void _model;
    return input.map(conceptVector);
  }
}

export class FakeChatClient implements ChatClient {
  async chat(): Promise<string> {
    throw new Error("FakeChatClient: no LLM in tests by default — matcher trusts the embedding shortlist");
  }
}

export interface DuoOptions {
  startIso?: string;
  statusDelayMs?: number;
  defaultAskTtlMs?: number;
  threshold?: number;
  annaChatClient?: ChatClient;
  benChatClient?: ChatClient;
  /**
   * D-QR4: whether to seed the mutual Anna<->Ben trust edges. Defaults to
   * `true` so every existing lifecycle test keeps its pre-connected pair
   * unchanged; the consent-gated CONNECT tests pass `false` to start from a
   * genuinely edge-less pair (a brand-new peer meeting an origin).
   */
  seedEdges?: boolean;
}

export interface Duo {
  clock: FakeClock;
  scheduler: FakeScheduler;
  bus: InMemoryBus;
  anna: Daemon;
  ben: Daemon;
  annaStore: SqliteStore;
  benStore: SqliteStore;
  sent: SentEnvelope[];
  roomMessages: SentRoomMessage[];
}

const ANNA_PEER = "@anna-agent:wot.local";
const BEN_PEER = "@ben-agent:wot.local";
const TIMO_PEER = "@timo-agent:wot.local";

export async function setupDuo(opts: DuoOptions = {}): Promise<Duo> {
  const clock = new FakeClock(opts.startIso ?? "2026-01-01T00:00:00.000Z");
  const scheduler = new FakeScheduler(clock);
  const bus = new InMemoryBus();
  const sent: SentEnvelope[] = [];
  const roomMessages: SentRoomMessage[] = [];

  const annaStore = new SqliteStore(":memory:");
  const benStore = new SqliteStore(":memory:");

  const matcherConfig = { embedModel: "fake-embed", chatModel: "fake-chat", threshold: opts.threshold ?? 0.6 };

  const annaConfig: DaemonConfig = {
    personaName: "Anna",
    peerId: ANNA_PEER,
    accent: "warm",
    statusDelayMs: opts.statusDelayMs ?? 30_000,
    defaultAskTtlMs: opts.defaultAskTtlMs ?? 3_600_000,
    matcher: matcherConfig,
  };
  const benConfig: DaemonConfig = { ...annaConfig, personaName: "Ben", peerId: BEN_PEER, accent: "steady" };

  const anna = new Daemon({
    config: annaConfig,
    store: annaStore,
    transport: new RecordingTransport(new InMemoryTransport(bus), "Anna", sent, roomMessages),
    scheduler,
    clock,
    embedClient: new FakeEmbedClient(),
    chatClient: opts.annaChatClient ?? new FakeChatClient(),
  });
  const ben = new Daemon({
    config: benConfig,
    store: benStore,
    transport: new RecordingTransport(new InMemoryTransport(bus), "Ben", sent, roomMessages),
    scheduler,
    clock,
    embedClient: new FakeEmbedClient(),
    chatClient: opts.benChatClient ?? new FakeChatClient(),
  });

  await anna.init();
  await ben.init();

  if (opts.seedEdges ?? true) {
    annaStore.putTrustEdge(TrustEdgeSchema.parse({ peer: BEN_PEER, display: "Ben", created_at: clock.nowIso(), expires_at: new Date(clock._currentMs() + 365 * 24 * 3600 * 1000).toISOString() }));
    benStore.putTrustEdge(TrustEdgeSchema.parse({ peer: ANNA_PEER, display: "Anna", created_at: clock.nowIso(), expires_at: new Date(clock._currentMs() + 365 * 24 * 3600 * 1000).toISOString() }));
  }

  return { clock, scheduler, bus, anna, ben, annaStore, benStore, sent, roomMessages };
}

export const PEERS = { ANNA: ANNA_PEER, BEN: BEN_PEER, TIMO: TIMO_PEER };

// ---------------------------------------------------------- three-daemon (relay) --

/**
 * Ben (asker) — Anna (holds a second_brain note) — Timo (real owner) — the
 * three-persona wiring Task 1's relay lifecycle tests need. Deliberately NO
 * trust edge between Ben and Timo: I8 says the noted owner may not know the
 * original asker, and the relay daemon (Anna) never introduces them directly
 * on the wire — only via the post-consent shared room.
 */
export interface TrioOptions {
  startIso?: string;
  statusDelayMs?: number;
  defaultAskTtlMs?: number;
  threshold?: number;
}

export interface Trio {
  clock: FakeClock;
  scheduler: FakeScheduler;
  bus: InMemoryBus;
  ben: Daemon;
  anna: Daemon;
  timo: Daemon;
  benStore: SqliteStore;
  annaStore: SqliteStore;
  timoStore: SqliteStore;
  sent: SentEnvelope[];
  roomMessages: SentRoomMessage[];
}

export async function setupTrio(opts: TrioOptions = {}): Promise<Trio> {
  const clock = new FakeClock(opts.startIso ?? "2026-01-01T00:00:00.000Z");
  const scheduler = new FakeScheduler(clock);
  const bus = new InMemoryBus();
  const sent: SentEnvelope[] = [];
  const roomMessages: SentRoomMessage[] = [];

  const benStore = new SqliteStore(":memory:");
  const annaStore = new SqliteStore(":memory:");
  const timoStore = new SqliteStore(":memory:");

  const matcherConfig = { embedModel: "fake-embed", chatModel: "fake-chat", threshold: opts.threshold ?? 0.6 };
  const shared = {
    statusDelayMs: opts.statusDelayMs ?? 30_000,
    defaultAskTtlMs: opts.defaultAskTtlMs ?? 3_600_000,
    matcher: matcherConfig,
  };

  const benConfig: DaemonConfig = { ...shared, personaName: "Ben", peerId: BEN_PEER, accent: "steady" };
  const annaConfig: DaemonConfig = { ...shared, personaName: "Anna", peerId: ANNA_PEER, accent: "warm" };
  const timoConfig: DaemonConfig = { ...shared, personaName: "Timo", peerId: TIMO_PEER, accent: "calm" };

  const ben = new Daemon({
    config: benConfig,
    store: benStore,
    transport: new RecordingTransport(new InMemoryTransport(bus), "Ben", sent, roomMessages),
    scheduler,
    clock,
    embedClient: new FakeEmbedClient(),
    chatClient: new FakeChatClient(),
  });
  const anna = new Daemon({
    config: annaConfig,
    store: annaStore,
    transport: new RecordingTransport(new InMemoryTransport(bus), "Anna", sent, roomMessages),
    scheduler,
    clock,
    embedClient: new FakeEmbedClient(),
    chatClient: new FakeChatClient(),
  });
  const timo = new Daemon({
    config: timoConfig,
    store: timoStore,
    transport: new RecordingTransport(new InMemoryTransport(bus), "Timo", sent, roomMessages),
    scheduler,
    clock,
    embedClient: new FakeEmbedClient(),
    chatClient: new FakeChatClient(),
  });

  await ben.init();
  await anna.init();
  await timo.init();

  const oneYearOut = () => new Date(clock._currentMs() + 365 * 24 * 3600 * 1000).toISOString();
  benStore.putTrustEdge(TrustEdgeSchema.parse({ peer: ANNA_PEER, display: "Anna", created_at: clock.nowIso(), expires_at: oneYearOut() }));
  annaStore.putTrustEdge(TrustEdgeSchema.parse({ peer: BEN_PEER, display: "Ben", created_at: clock.nowIso(), expires_at: oneYearOut() }));
  annaStore.putTrustEdge(TrustEdgeSchema.parse({ peer: TIMO_PEER, display: "Timo", created_at: clock.nowIso(), expires_at: oneYearOut() }));
  timoStore.putTrustEdge(TrustEdgeSchema.parse({ peer: ANNA_PEER, display: "Anna", created_at: clock.nowIso(), expires_at: oneYearOut() }));

  return { clock, scheduler, bus, ben, anna, timo, benStore, annaStore, timoStore, sent, roomMessages };
}
