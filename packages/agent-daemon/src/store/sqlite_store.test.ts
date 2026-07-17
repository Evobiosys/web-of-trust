import { describe, expect, it, beforeEach } from "vitest";
import type { Item, TrustEdge } from "@resource-web/protocol";
import { ItemSchema, TrustEdgeSchema } from "@resource-web/protocol";
import { SqliteStore } from "./sqlite_store.js";
import type { AskRecord, AuditRecord, IncomingRecord } from "./types.js";

function makeItem(overrides: Partial<Item> = {}): Item {
  return ItemSchema.parse({
    id: overrides.id ?? "item-1",
    labels: overrides.labels ?? ["Bosch IXO Akkuschrauber", "cordless screwdriver"],
    description: overrides.description ?? "Kleiner Akkuschrauber, kaum genutzt.",
    tags: overrides.tags ?? ["tools", "diy"],
    provenance: overrides.provenance ?? { kind: "self" },
    policy: overrides.policy ?? {},
    location_area: overrides.location_area ?? "Wien-Ottakring",
  });
}

function makeEdge(overrides: Partial<TrustEdge> = {}): TrustEdge {
  return TrustEdgeSchema.parse({
    peer: overrides.peer ?? "@anna-agent:wot.local",
    display: overrides.display ?? "Anna",
    created_at: overrides.created_at ?? "2026-01-01T00:00:00.000Z",
    expires_at: overrides.expires_at,
  });
}

describe("SqliteStore", () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(":memory:");
  });

  it("round-trips an Item through JSON columns without loss", () => {
    const item = makeItem();
    store.putItem(item);
    expect(store.getItem("item-1")).toEqual(item);
    expect(store.getItems()).toEqual([item]);
  });

  it("upserts an item on conflict (same id)", () => {
    store.putItem(makeItem({ description: "v1" }));
    store.putItem(makeItem({ description: "v2" }));
    expect(store.getItems()).toHaveLength(1);
    expect(store.getItem("item-1")?.description).toBe("v2");
  });

  it("caches and retrieves item embeddings keyed by (item_id, model)", () => {
    expect(store.getItemEmbedding("item-1", "qwen3-embedding:8b")).toBeUndefined();
    store.putItemEmbedding("item-1", "qwen3-embedding:8b", [0.1, 0.2, 0.3]);
    expect(store.getItemEmbedding("item-1", "qwen3-embedding:8b")).toEqual([0.1, 0.2, 0.3]);
    expect(store.getItemEmbedding("item-1", "other-model")).toBeUndefined();
  });

  it("round-trips a TrustEdge", () => {
    const edge = makeEdge();
    store.putTrustEdge(edge);
    expect(store.getTrustEdge("@anna-agent:wot.local")).toEqual(edge);
    expect(store.getTrustEdges()).toEqual([edge]);
  });

  it("round-trips an AskRecord including nested peers array", () => {
    const ask: AskRecord = {
      request_id: "11111111-1111-4111-8111-111111111111",
      text: "Hat wer einen Akkuschrauber?",
      created_at: "2026-01-01T00:00:00.000Z",
      ttl_ms: 3_600_000,
      internal_state: "open",
      queried_count: 1,
      peers: [{ peer: "@ben-agent:wot.local", state: "queried" }],
    };
    store.putAsk(ask);
    expect(store.getAsk(ask.request_id)).toEqual(ask);
    store.putAsk({ ...ask, internal_state: "pending", peers: [{ peer: "@ben-agent:wot.local", state: "pending" }] });
    expect(store.getAsk(ask.request_id)?.internal_state).toBe("pending");
    expect(store.getAsks()).toHaveLength(1);
  });

  it("round-trips an IncomingRecord (consent card)", () => {
    const incoming: IncomingRecord = {
      card_id: "card-1",
      request_id: "11111111-1111-4111-8111-111111111111",
      requester_peer: "@anna-agent:wot.local",
      requester_display: "Anna",
      text: "Hat wer einen Akkuschrauber?",
      received_at: "2026-01-01T00:00:00.000Z",
      matched_item_id: "item-1",
      kind: "direct",
      state: "pending",
      internal_state: "matched",
      status_dispatch_at: "2026-01-01T00:00:02.000Z",
      status_dispatched: false,
    };
    store.putIncoming(incoming);
    expect(store.getIncoming("card-1")).toEqual(incoming);
    expect(store.getIncomingByRequestAndPeer(incoming.request_id, incoming.requester_peer)).toEqual(incoming);
    expect(store.getIncomings()).toEqual([incoming]);
  });

  it("round-trips rooms and appends room messages in order", () => {
    store.putRoom({
      room_id: "room-1",
      request_id: "11111111-1111-4111-8111-111111111111",
      peers: [{ peer_id: "@anna-agent:wot.local", display: "Anna" }, { peer_id: "@ben-agent:wot.local", display: "Ben" }],
      context: "Akkuschrauber for Anna",
      created_at: "2026-01-01T00:00:03.000Z",
    });
    expect(store.getRooms()).toHaveLength(1);
    store.addRoomMessage({ room_id: "room-1", from: "@ben-agent:wot.local", text: "Klar!", ts: "2026-01-01T00:00:04.000Z" });
    store.addRoomMessage({ room_id: "room-1", from: "@anna-agent:wot.local", text: "Danke!", ts: "2026-01-01T00:00:05.000Z" });
    expect(store.getRoomMessages("room-1").map((m) => m.text)).toEqual(["Klar!", "Danke!"]);
  });

  it("appends steward log entries in order", () => {
    store.addStewardLog({ role: "user", text: "Hat wer einen Akkuschrauber?", ts: "2026-01-01T00:00:00.000Z" });
    store.addStewardLog({ role: "agent", text: "Asked 1 trusted people nearby.", ts: "2026-01-01T00:00:00.100Z" });
    expect(store.getStewardLog()).toEqual([
      { role: "user", text: "Hat wer einen Akkuschrauber?", ts: "2026-01-01T00:00:00.000Z" },
      { role: "agent", text: "Asked 1 trusted people nearby.", ts: "2026-01-01T00:00:00.100Z" },
    ]);
  });

  it("stores, retrieves latest, and clears a pending capture proposal", () => {
    expect(store.getLatestPendingCapture()).toBeUndefined();
    store.putPendingCapture({
      proposal_id: "prop-1",
      item: { labels: ["Bosch IXO"], description: "…", tags: [], provenance: { kind: "self" }, policy: ItemSchema.shape.policy.parse({}) },
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const latest = store.getLatestPendingCapture();
    expect(latest?.proposal_id).toBe("prop-1");
    store.clearPendingCapture("prop-1");
    expect(store.getLatestPendingCapture()).toBeUndefined();
  });

  it("appends audit entries with the redaction flag intact", () => {
    const entry: AuditRecord = {
      ts: "2026-01-01T00:00:00.000Z",
      request_id: "11111111-1111-4111-8111-111111111111",
      actor: "asker",
      action: "sent_request",
      redact_for_asker: true,
      detail: "Fanned out REQUEST to 1 trusted peer.",
    };
    store.addAudit(entry);
    expect(store.getAudit()).toEqual([entry]);
  });
});
