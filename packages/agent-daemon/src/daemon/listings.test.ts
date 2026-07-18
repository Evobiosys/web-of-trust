// D14 — trust levels, listings (offer/gathering), loans, DM threads.
// Integration-level tests against the Daemon's public surface, same style as
// daemon.test.ts (two/three in-process daemons over InMemoryBus + FakeClock).
import { describe, expect, it } from "vitest";
import { TrustEdgeSchema } from "@resource-web/protocol";
import { PEERS, setupDuo, setupTrio } from "./test_harness.js";

describe("Daemon lifecycle — listing tier filtering (D14)", () => {
  it("a peer below a listing's tier receives NOTHING — private=invisible, never a locked state", async () => {
    const { ben, benStore, annaStore, sent } = await setupDuo();
    // Downgrade Ben's edge to Anna below "trusted" (close|friend) — Anna is only a "contact".
    benStore.putTrustEdge(TrustEdgeSchema.parse({ peer: PEERS.ANNA, display: "Anna", level: "contact", created_at: "2026-01-01T00:00:00.000Z" }));

    await ben.publishListing({ kind: "offer", title: "Cordless drill", description: "Bosch IXO", tier: "trusted" });

    expect(sent.filter((s) => s.env.type === "LISTING")).toHaveLength(0);
    expect(annaStore.getReceivedListings()).toHaveLength(0);
  });

  it("trusted tier reaches both friend and close level edges", async () => {
    const { ben, annaStore } = await setupDuo();
    await ben.publishListing({ kind: "offer", title: "Cordless drill", description: "Bosch IXO", tier: "trusted" });
    expect(annaStore.getReceivedListings()).toHaveLength(1);
  });
});

describe("Daemon lifecycle — listing forwarding (D14, declared reach)", () => {
  it("forwards within declared reach: decrements steps, appends via, excludes the sender, stops at steps=1", async () => {
    const { ben, benStore, annaStore, timoStore, sent } = await setupTrio();

    const listing = await ben.publishListing({ kind: "offer", title: "3m ladder", description: "aluminium", tier: "trusted", steps: 2 });

    const annaReceived = annaStore.getReceivedListing(listing.listing_id);
    expect(annaReceived?.via).toEqual([]);
    expect(annaReceived?.steps).toBe(2);
    expect(annaReceived?.from_peer).toBe(PEERS.BEN);

    const timoReceived = timoStore.getReceivedListing(listing.listing_id);
    expect(timoReceived?.via).toEqual([PEERS.ANNA]);
    expect(timoReceived?.steps).toBe(1);
    expect(timoReceived?.from_peer).toBe(PEERS.ANNA);

    // Ben never receives his own listing back; nothing propagates past Timo (steps exhausted at 1).
    expect(benStore.getReceivedListings()).toHaveLength(0);
    expect(sent.filter((s) => s.env.type === "LISTING")).toHaveLength(2);
  });

  it("never forwards a close-tier listing, regardless of remaining steps (inner room stays inner)", async () => {
    const { ben, benStore, annaStore, timoStore, sent } = await setupTrio();
    benStore.putTrustEdge(TrustEdgeSchema.parse({ peer: PEERS.ANNA, display: "Anna", level: "close", created_at: "2026-01-01T00:00:00.000Z" }));
    annaStore.putTrustEdge(TrustEdgeSchema.parse({ peer: PEERS.TIMO, display: "Timo", level: "close", created_at: "2026-01-01T00:00:00.000Z" }));

    await ben.publishListing({ kind: "offer", title: "Family heirloom drill", description: "sentimental", tier: "close", steps: 3 });

    expect(annaStore.getReceivedListings()).toHaveLength(1);
    expect(timoStore.getReceivedListings()).toHaveLength(0);
    expect(sent.filter((s) => s.env.type === "LISTING")).toHaveLength(1);
  });

  it("never forwards a listing back to its own owner, even through a cyclic trust graph", async () => {
    const { ben, benStore, annaStore, timoStore } = await setupTrio();
    // Close the cycle Ben -> Anna -> Timo -> Ben (setupTrio deliberately omits this edge).
    timoStore.putTrustEdge(TrustEdgeSchema.parse({ peer: PEERS.BEN, display: "Ben", created_at: "2026-01-01T00:00:00.000Z" }));

    await ben.publishListing({ kind: "offer", title: "3m ladder", description: "aluminium", tier: "trusted", steps: 3 });

    expect(benStore.getReceivedListings()).toHaveLength(0);
    expect(annaStore.getReceivedListings()).toHaveLength(1);
    expect(timoStore.getReceivedListings()).toHaveLength(1);
  });

  it("withdraw propagates along the same route; receivers mark the listing withdrawn", async () => {
    const { ben, annaStore, timoStore } = await setupTrio();
    const listing = await ben.publishListing({ kind: "offer", title: "3m ladder", description: "aluminium", tier: "trusted", steps: 2 });
    expect(timoStore.getReceivedListing(listing.listing_id)?.state).toBe("active");

    await ben.withdrawListing(listing.listing_id);

    expect(annaStore.getReceivedListing(listing.listing_id)?.state).toBe("withdrawn");
    expect(timoStore.getReceivedListing(listing.listing_id)?.state).toBe("withdrawn");
  });
});

describe("Daemon lifecycle — loans (D14)", () => {
  it("happy path: requested -> approved -> lent -> returned -> complete (both sides independently check in)", async () => {
    const { ben, anna, benStore, annaStore } = await setupDuo();
    const listing = await ben.publishListing({ kind: "offer", title: "Cordless drill", description: "Bosch IXO", tier: "trusted" });

    const loan = await anna.requestBorrow(listing.listing_id);
    expect(benStore.getLoan(loan.loan_id)).toMatchObject({ role: "owner", state: "requested" });
    expect(annaStore.getLoan(loan.loan_id)).toMatchObject({ role: "borrower", state: "requested" });

    await ben.approveLoan(loan.loan_id);
    expect(annaStore.getLoan(loan.loan_id)?.state).toBe("approved");

    await ben.markLent(loan.loan_id);
    expect(annaStore.getLoan(loan.loan_id)?.state).toBe("lent");

    await anna.markReturned(loan.loan_id);
    expect(benStore.getLoan(loan.loan_id)?.state).toBe("returned");

    await ben.checkInLoanCompletion(loan.loan_id, "complete");
    await anna.checkInLoanCompletion(loan.loan_id, "complete");
    expect(benStore.getLoan(loan.loan_id)?.state).toBe("complete");
    expect(annaStore.getLoan(loan.loan_id)?.state).toBe("complete");
  });

  it("owner can decline a borrow request", async () => {
    const { ben, anna, benStore, annaStore } = await setupDuo();
    const listing = await ben.publishListing({ kind: "offer", title: "Cordless drill", description: "Bosch IXO", tier: "trusted" });
    const loan = await anna.requestBorrow(listing.listing_id);

    await ben.declineLoan(loan.loan_id);

    expect(benStore.getLoan(loan.loan_id)?.state).toBe("declined");
    expect(annaStore.getLoan(loan.loan_id)?.state).toBe("declined");
  });

  it("not_yet: the completion detail never appears on the wire — stays local to the checking-in party (mockup RES-5)", async () => {
    const { ben, anna, benStore, annaStore, sent } = await setupDuo();
    const listing = await ben.publishListing({ kind: "offer", title: "Cordless drill", description: "Bosch IXO", tier: "trusted" });
    const loan = await anna.requestBorrow(listing.listing_id);
    await ben.approveLoan(loan.loan_id);
    await ben.markLent(loan.loan_id);
    await anna.markReturned(loan.loan_id);

    await ben.checkInLoanCompletion(loan.loan_id, "not_yet", "came back scratched, sorting it out directly with Anna");

    expect(benStore.getLoan(loan.loan_id)?.state).toBe("not_yet");
    expect(benStore.getLoan(loan.loan_id)?.completion_detail).toBe("came back scratched, sorting it out directly with Anna");
    // Anna's own copy never learns the detail — only the coarse outcome.
    expect(annaStore.getLoan(loan.loan_id)?.state).toBe("not_yet");
    expect(annaStore.getLoan(loan.loan_id)?.completion_detail).toBeUndefined();

    const wireDump = JSON.stringify(sent.map((s) => s.env));
    expect(wireDump).not.toContain("scratched");
  });

  it("alpha: borrowing a listing that only arrived via a forward (not direct) is rejected", async () => {
    const { ben, timo } = await setupTrio();
    const listing = await ben.publishListing({ kind: "offer", title: "3m ladder", description: "aluminium", tier: "trusted", steps: 2 });
    // Timo only has this via Anna's forward (via.length > 0) — alpha borrow is direct-connection only.
    await expect(timo.requestBorrow(listing.listing_id)).rejects.toThrow();
  });
});

describe("Daemon lifecycle — DM threads (D14)", () => {
  it("sends and receives DMs both directions between connected peers", async () => {
    const { anna, ben, annaStore, benStore } = await setupDuo();
    await anna.sendDm(PEERS.BEN, "Hey Ben, still around Saturday?");
    await ben.sendDm(PEERS.ANNA, "Yep, see you then!");

    expect(annaStore.getDmMessages(PEERS.BEN).map((m) => ({ direction: m.direction, text: m.text }))).toEqual([
      { direction: "outgoing", text: "Hey Ben, still around Saturday?" },
      { direction: "incoming", text: "Yep, see you then!" },
    ]);
    expect(benStore.getDmMessages(PEERS.ANNA).map((m) => ({ direction: m.direction, text: m.text }))).toEqual([
      { direction: "incoming", text: "Hey Ben, still around Saturday?" },
      { direction: "outgoing", text: "Yep, see you then!" },
    ]);

    const annaThreads = anna.getStateSnapshot().threads;
    expect(annaThreads).toHaveLength(1);
    expect(annaThreads[0].peer_id).toBe(PEERS.BEN);
    const benThreads = ben.getStateSnapshot().threads;
    expect(benThreads).toHaveLength(1);
    expect(benThreads[0].peer_id).toBe(PEERS.ANNA);
  });

  it("refuses to send a DM to a peer with no trust edge", async () => {
    const { ben } = await setupDuo();
    await expect(ben.sendDm("@stranger:wot.local", "hi")).rejects.toThrow();
  });

  it("drops an incoming DM from an unconnected peer (connected-only, defense in depth)", async () => {
    const { bus, benStore } = await setupTrio();
    await bus.deliver(PEERS.BEN, "@stranger:wot.local", {
      v: "0.1",
      type: "DM",
      request_id: "11111111-1111-4111-8111-111111111111",
      ts: "2026-01-01T00:00:00.000Z",
      body: { text: "spam" },
    });
    expect(benStore.getDmMessages("@stranger:wot.local")).toHaveLength(0);
  });
});

describe("Daemon state snapshot — D14 getters", () => {
  it("exposes listings_mine, listings_received, loans, threads, and trust_edges[].level", async () => {
    const { ben, anna, benStore } = await setupDuo();
    benStore.putTrustEdge(TrustEdgeSchema.parse({ peer: PEERS.ANNA, display: "Anna", level: "close", created_at: "2026-01-01T00:00:00.000Z" }));

    const listing = await ben.publishListing({ kind: "offer", title: "Cordless drill", description: "Bosch IXO", tier: "trusted" });
    await anna.requestBorrow(listing.listing_id);

    const benState = ben.getStateSnapshot();
    expect(benState.listings_mine).toHaveLength(1);
    expect(benState.listings_mine[0].listing_id).toBe(listing.listing_id);
    expect(benState.loans).toHaveLength(1);
    expect(benState.trust_edges.find((e) => e.peer === PEERS.ANNA)?.level).toBe("close");

    const annaState = anna.getStateSnapshot();
    expect(annaState.listings_received).toHaveLength(1);
    expect(annaState.listings_received[0].listing_id).toBe(listing.listing_id);
  });
});
