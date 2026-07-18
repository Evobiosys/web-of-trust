// Task 4 (D18): consent-gated inbound CONNECT — origin-node onboarding.
// A brand-new self-sovereign peer (Anna, no prior edge) sends CONNECT to an
// origin (Ben). Ben surfaces a consent card and decides; only on the owner's
// explicit accept does either side gain a trust edge. Uses the two-daemon
// harness with NO seeded edge between the pair.
import { describe, expect, it } from "vitest";
import type { Envelope } from "@resource-web/protocol";
import { PEERS, setupDuo } from "./test_harness.js";

/** Test-only view onto the daemon's transport-level intake (normally invoked
 * by the transport's onEnvelope). Lets a scenario inject a forged inbound
 * envelope exactly as a malicious peer's transport would deliver it, with the
 * transport-authenticated `from` under the test's control. */
type Receivable = { handleEnvelope(from: string, env: Envelope): Promise<void> };

describe("Task 4 — consent-gated inbound CONNECT (origin-node)", () => {
  it("CONNECT from an unknown peer surfaces a pending consent card and forms NO edge", async () => {
    const { anna, ben, annaStore, benStore, sent } = await setupDuo({ seedEdges: false });

    // Precondition: genuinely edge-less pair.
    expect(annaStore.getTrustEdge(PEERS.BEN)).toBeUndefined();
    expect(benStore.getTrustEdge(PEERS.ANNA)).toBeUndefined();

    await anna.sendConnect(PEERS.BEN, { display: "Anna", level: "close" });

    // Ben (origin) sees a pending inbound connect card with full requester
    // context (I4): the requester's transport DID + chosen display.
    const cards = ben.getStateSnapshot().connect_cards.filter((c) => c.direction === "inbound");
    expect(cards).toHaveLength(1);
    expect(cards[0].peer.peer_id).toBe(PEERS.ANNA);
    expect(cards[0].peer.display).toBe("Anna");
    expect(cards[0].requested_level).toBe("close");
    expect(cards[0].state).toBe("pending");

    // No edge yet on EITHER side — consent-gated (I4). Anna tracks her own
    // outbound pending card; Ben has an inbound pending card.
    expect(benStore.getTrustEdge(PEERS.ANNA)).toBeUndefined();
    expect(annaStore.getTrustEdge(PEERS.BEN)).toBeUndefined();
    expect(anna.getStateSnapshot().connect_cards.filter((c) => c.direction === "outbound")[0].state).toBe("pending");

    // A CONNECT was on the wire; no CONNECT_ACK yet (Ben hasn't decided).
    expect(sent.some((s) => s.env.type === "CONNECT")).toBe(true);
    expect(sent.some((s) => s.env.type === "CONNECT_ACK")).toBe(false);
  });

  it("owner accept → BOTH sides end with a trust edge; requested 'close' is clamped to 'friend' (I9, no auto-escalation)", async () => {
    const { anna, ben, annaStore, benStore, sent } = await setupDuo({ seedEdges: false });

    await anna.sendConnect(PEERS.BEN, { display: "Anna", level: "close" });
    const card = ben.getStateSnapshot().connect_cards.find((c) => c.direction === "inbound")!;

    await ben.acceptConnect(card.card_id);

    // Ben's edge to Anna.
    const benEdge = benStore.getTrustEdge(PEERS.ANNA);
    expect(benEdge).toBeDefined();
    expect(benEdge!.display).toBe("Anna");
    expect(benEdge!.level).toBe("friend"); // clamped down from requested "close"

    // Anna's reciprocal edge to Ben, formed from the CONNECT_ACK — carries
    // Ben's own display, not the placeholder DID.
    const annaEdge = annaStore.getTrustEdge(PEERS.BEN);
    expect(annaEdge).toBeDefined();
    expect(annaEdge!.display).toBe("Ben");
    expect(annaEdge!.level).toBe("friend");

    // +1y expiry on both (I9).
    expect(new Date(benEdge!.expires_at).getUTCFullYear()).toBe(2027);
    expect(new Date(annaEdge!.expires_at).getUTCFullYear()).toBe(2027);

    // A single CONNECT_ACK{accepted:true} carried Ben's display back to Anna.
    const ack = sent.find((s) => s.env.type === "CONNECT_ACK")!.env;
    if (ack.type !== "CONNECT_ACK") throw new Error("expected CONNECT_ACK");
    expect(ack.body).toEqual({ accepted: true, display: "Ben" });

    // Cards on both sides resolved to accepted.
    expect(ben.getStateSnapshot().connect_cards[0].state).toBe("accepted");
    expect(anna.getStateSnapshot().connect_cards[0].state).toBe("accepted");
  });

  it("owner may sovereignly grant a higher level explicitly (I4 override)", async () => {
    const { anna, ben, benStore } = await setupDuo({ seedEdges: false });
    await anna.sendConnect(PEERS.BEN, { display: "Anna" });
    const card = ben.getStateSnapshot().connect_cards.find((c) => c.direction === "inbound")!;

    await ben.acceptConnect(card.card_id, "close");
    expect(benStore.getTrustEdge(PEERS.ANNA)!.level).toBe("close");
  });

  it("owner decline → NO edge either side; Anna gets accepted:false and nothing else leaks", async () => {
    const { anna, ben, annaStore, benStore, sent } = await setupDuo({ seedEdges: false });

    await anna.sendConnect(PEERS.BEN, { display: "Anna" });
    const card = ben.getStateSnapshot().connect_cards.find((c) => c.direction === "inbound")!;

    await ben.declineConnect(card.card_id);

    // No edge formed anywhere.
    expect(benStore.getTrustEdge(PEERS.ANNA)).toBeUndefined();
    expect(annaStore.getTrustEdge(PEERS.BEN)).toBeUndefined();

    // The decline ACK reveals nothing beyond "not accepted" — no display, no
    // reason (byte-shape asserted).
    const ack = sent.find((s) => s.env.type === "CONNECT_ACK")!.env;
    if (ack.type !== "CONNECT_ACK") throw new Error("expected CONNECT_ACK");
    expect(ack.body).toEqual({ accepted: false });

    // Both cards resolved to declined.
    expect(ben.getStateSnapshot().connect_cards[0].state).toBe("declined");
    expect(anna.getStateSnapshot().connect_cards.find((c) => c.direction === "outbound")!.state).toBe("declined");
  });

  it("duplicate CONNECT from the same peer keeps exactly one pending origin card", async () => {
    const { anna, ben, benStore } = await setupDuo({ seedEdges: false });

    await anna.sendConnect(PEERS.BEN, { display: "Anna" });
    await anna.sendConnect(PEERS.BEN, { display: "Anna (again)" });

    const inbound = ben.getStateSnapshot().connect_cards.filter((c) => c.direction === "inbound");
    expect(inbound).toHaveLength(1);
    // Refreshed to the latest display, still pending, still no edge.
    expect(inbound[0].peer.display).toBe("Anna (again)");
    expect(inbound[0].state).toBe("pending");
    expect(benStore.getTrustEdge(PEERS.ANNA)).toBeUndefined();
  });

  it("an unsolicited CONNECT_ACK{accepted:true} never conjures an edge (transport-auth + correlation guard)", async () => {
    const { ben, benStore } = await setupDuo({ seedEdges: false });

    // Ben never sent a CONNECT to Anna, yet receives a forged accept from her.
    await (ben as unknown as Receivable).handleEnvelope(PEERS.ANNA, {
      v: "0.1",
      type: "CONNECT_ACK",
      request_id: "00000000-0000-4000-8000-000000000000",
      ts: "2026-01-01T00:00:00.000Z",
      body: { accepted: true, display: "Anna" },
    });

    expect(benStore.getTrustEdge(PEERS.ANNA)).toBeUndefined();
  });
});
