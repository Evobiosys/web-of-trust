import { describe, expect, it, beforeEach } from "vitest";
import type { Item, TrustEdge } from "@resource-web/protocol";
import { ItemSchema, TrustEdgeSchema } from "@resource-web/protocol";
import type { CredentialRecord } from "@resource-web/transport";
import { SqliteStore } from "./sqlite_store.js";
import type { AskRecord, AuditRecord, DmMessageRecord, IncomingRecord, ListingRecord, LoanRecord, ReceivedListingRecord } from "./types.js";

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
    level: overrides.level,
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

  it("round-trips a TrustEdge including level", () => {
    const edge = makeEdge({ level: "close" });
    store.putTrustEdge(edge);
    expect(store.getTrustEdge(edge.peer)?.level).toBe("close");
  });

  it("round-trips a ListingRecord (listings_mine) and upserts on conflict", () => {
    const listing: ListingRecord = {
      listing_id: "listing-1",
      kind: "offer",
      title: "Cordless drill",
      description: "Bosch IXO, barely used.",
      tier: "trusted",
      steps: 2,
      owner_display: "Ben",
      state: "active",
      created_at: "2026-01-01T00:00:00.000Z",
    };
    store.putListing(listing);
    expect(store.getListing("listing-1")).toEqual(listing);
    expect(store.getListings()).toEqual([listing]);

    store.putListing({ ...listing, state: "withdrawn" });
    expect(store.getListings()).toHaveLength(1);
    expect(store.getListing("listing-1")?.state).toBe("withdrawn");
  });

  it("round-trips a ListingRecord's optional when/where fields", () => {
    const listing: ListingRecord = {
      listing_id: "listing-2",
      kind: "gathering",
      title: "Repair café",
      description: "Bring broken stuff.",
      when: "Saturday 3pm",
      where_public: "Wien-Ottakring",
      where_gated: "Herbeckstraße 12",
      tier: "wot_commons",
      steps: 1,
      owner_display: "Ben",
      state: "active",
      created_at: "2026-01-01T00:00:00.000Z",
    };
    store.putListing(listing);
    expect(store.getListing("listing-2")).toEqual(listing);
  });

  it("round-trips a ReceivedListingRecord including via chain and forwarded flag", () => {
    const received: ReceivedListingRecord = {
      listing_id: "listing-1",
      kind: "offer",
      title: "Cordless drill",
      description: "Bosch IXO, barely used.",
      tier: "trusted",
      steps: 1,
      via: ["@anna-agent:wot.local"],
      owner_display: "Ben",
      state: "active",
      from_peer: "@anna-agent:wot.local",
      received_at: "2026-01-01T00:00:01.000Z",
      forwarded: false,
    };
    store.putReceivedListing(received);
    expect(store.getReceivedListing("listing-1")).toEqual(received);
    expect(store.getReceivedListings()).toEqual([received]);

    store.putReceivedListing({ ...received, forwarded: true });
    expect(store.getReceivedListings()).toHaveLength(1);
    expect(store.getReceivedListing("listing-1")?.forwarded).toBe(true);
  });

  it("round-trips a LoanRecord including completion_detail (local-only field)", () => {
    const loan: LoanRecord = {
      loan_id: "loan-1",
      listing_id: "listing-1",
      role: "owner",
      counterparty_peer: "@anna-agent:wot.local",
      counterparty_display: "Anna",
      state: "requested",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    store.putLoan(loan);
    expect(store.getLoan("loan-1")).toEqual(loan);
    expect(store.getLoans()).toEqual([loan]);

    const updated: LoanRecord = { ...loan, state: "not_yet", completion_detail: "came back scratched", updated_at: "2026-01-02T00:00:00.000Z" };
    store.putLoan(updated);
    expect(store.getLoans()).toHaveLength(1);
    expect(store.getLoan("loan-1")).toEqual(updated);
  });

  it("appends DM messages in order per peer and lists distinct thread peers", () => {
    const anna = "@anna-agent:wot.local";
    const timo = "@timo-agent:wot.local";
    const m1: DmMessageRecord = { peer: anna, direction: "outgoing", text: "Hey!", ts: "2026-01-01T00:00:00.000Z" };
    const m2: DmMessageRecord = { peer: anna, direction: "incoming", text: "Hi there", ts: "2026-01-01T00:00:01.000Z" };
    const m3: DmMessageRecord = { peer: timo, direction: "outgoing", text: "Yo Timo", ts: "2026-01-01T00:00:02.000Z" };
    store.addDmMessage(m1);
    store.addDmMessage(m2);
    store.addDmMessage(m3);

    expect(store.getDmMessages(anna)).toEqual([m1, m2]);
    expect(store.getDmMessages(timo)).toEqual([m3]);
    expect(store.getDmPeers().sort()).toEqual([anna, timo].sort());
  });

  // ------------------------------------ credential-provider seam: CredentialStore --

  describe("CredentialStore (credentials table)", () => {
    function makeCredentialRecord(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
      return {
        id: overrides.id ?? "cred-1",
        kind: overrides.kind ?? "relationship",
        credential: overrides.credential ?? ({
          "@context": ["https://www.w3.org/2018/credentials/v1"],
          type: ["VerifiableCredential", "RelationshipCredential"],
          issuer: "did:peer:2.issuer",
          issuanceDate: "2026-01-01T00:00:00.000Z",
          credentialSubject: { id: "did:peer:2.subject", relationship: "trusted" },
          proof: { type: "Ed25519Signature2020", created: "2026-01-01T00:00:00.000Z", verificationMethod: "did:peer:2.issuer", proofPurpose: "assertionMethod", jws: "fake-jws" },
        } as unknown as CredentialRecord["credential"]),
        issued_at: overrides.issued_at ?? "2026-01-01T00:00:00.000Z",
        revoked_at: overrides.revoked_at,
      };
    }

    it("round-trips a credential record through the JSON column", () => {
      const record = makeCredentialRecord();
      store.put(record);
      expect(store.get("cred-1")).toEqual(record);
      expect(store.list()).toEqual([record]);
    });

    it("markRevoked sets revoked_at and is idempotent (a second call does not move the timestamp)", () => {
      store.put(makeCredentialRecord());
      expect(store.get("cred-1")?.revoked_at).toBeUndefined();

      store.markRevoked("cred-1", "2026-01-02T00:00:00.000Z");
      expect(store.get("cred-1")?.revoked_at).toBe("2026-01-02T00:00:00.000Z");

      store.markRevoked("cred-1", "2026-01-03T00:00:00.000Z"); // later call, same id
      expect(store.get("cred-1")?.revoked_at).toBe("2026-01-02T00:00:00.000Z"); // unchanged
    });

    it("put() on an id collision preserves an existing revoked_at instead of clearing it (sticky revocation)", () => {
      store.put(makeCredentialRecord());
      store.markRevoked("cred-1", "2026-01-02T00:00:00.000Z");

      // A fresh put() for the SAME id (e.g. LocalVrcProvider re-issuing
      // byte-identical content within the same clock tick) must not silently
      // un-revoke the row.
      store.put(makeCredentialRecord());
      expect(store.get("cred-1")?.revoked_at).toBe("2026-01-02T00:00:00.000Z");
    });

    it("markRevoked on an unknown id is a harmless no-op", () => {
      expect(() => store.markRevoked("does-not-exist", "2026-01-02T00:00:00.000Z")).not.toThrow();
      expect(store.get("does-not-exist")).toBeUndefined();
    });
  });
});
