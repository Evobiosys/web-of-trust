import { describe, expect, it } from "vitest";
import { ItemSchema, serializeEnvelope, type Item, type Provenance } from "@resource-web/protocol";
import { PEERS, setupDuo, setupTrio } from "./test_harness.js";

interface BenItemInput {
  id: string;
  labels: string[];
  description: string;
  policy?: { mode?: "ask_each_time" | "auto_forward"; audience?: "private" | "trusted" | "wot_commons" };
}

function benItem(input: BenItemInput): Item {
  return ItemSchema.parse({ tags: [], provenance: { kind: "self" }, ...input, policy: input.policy ?? {} });
}

const SCREWDRIVER = benItem({ id: "screwdriver", labels: ["Bosch IXO cordless screwdriver", "Akkuschrauber"], description: "Small cordless screwdriver, barely used." });

interface RelayItemInput {
  id: string;
  labels: string[];
  description: string;
  provenance: Provenance;
  policy?: { mode?: "ask_each_time" | "auto_forward"; audience?: "private" | "trusted" | "wot_commons" };
}

function relayItem(input: RelayItemInput): Item {
  return ItemSchema.parse({ tags: [], ...input, policy: input.policy ?? {} });
}

// Anna's second_brain note about Timo's ladder — the relay trigger (I8).
function ladderNote(policy?: RelayItemInput["policy"]): Item {
  return relayItem({
    id: "timo-ladder-note",
    labels: ["3m ladder", "Leiter"],
    description: "Timo has a 3m aluminium ladder he lends out.",
    provenance: { kind: "second_brain", owner: PEERS.TIMO, noted_at: "2026-01-01T00:00:00.000Z" },
    policy,
  });
}

// Timo's own real inventory item — matched directly once the relay REQUEST reaches him.
const REAL_LADDER = relayItem({
  id: "ladder",
  labels: ["3m ladder", "Leiter"],
  description: "3 meter aluminium ladder, good condition.",
  provenance: { kind: "self" },
});

describe("Daemon lifecycle — happy path (ask_each_time, Yes branch)", () => {
  it("Anna asks, Ben matches + consents, room opens, both sides see it — while staying I2/I3-clean throughout", async () => {
    const { clock, scheduler, anna, ben, annaStore, benStore, sent } = await setupDuo({ statusDelayMs: 2000 });
    benStore.putItem(SCREWDRIVER);

    const ask = await anna.sendAsk("Hat wer in meiner Nähe einen Akkuschrauber?");
    expect(ask.queried_count).toBe(1);

    // Before the uniform delay: asker sees "open"/"waiting", never per-peer info.
    let annaState = anna.getStateSnapshot();
    expect(annaState.asks[0].state === "open" || annaState.asks[0].state === "waiting").toBe(true);

    // Ben's daemon received REQUEST and created a consent card immediately (I4: owner sees full context).
    const benState = ben.getStateSnapshot();
    expect(benState.consent_cards).toHaveLength(1);
    const card = benState.consent_cards[0];
    expect(card.requester.peer_id).toBe(PEERS.ANNA);
    expect(card.state).toBe("pending");

    // Owner consents BEFORE the uniform delay fires — I3 says the CONSENT
    // must not go out before the uniform STATUS(PENDING) does.
    await ben.consent(card.card_id);
    expect(sent.some((s) => s.env.type === "CONSENT")).toBe(false);

    await scheduler.advance(2000); // fire the uniform STATUS dispatch

    const pendingIdx = sent.findIndex((s) => s.env.type === "STATUS");
    const consentIdx = sent.findIndex((s) => s.env.type === "CONSENT");
    expect(pendingIdx).toBeGreaterThanOrEqual(0);
    expect(consentIdx).toBeGreaterThan(pendingIdx); // PENDING always precedes CONSENT on the wire

    annaState = anna.getStateSnapshot();
    expect(annaState.asks[0].state).toBe("room_open");
    expect(annaState.asks[0].room_id).toBeDefined();

    const roomId = annaState.asks[0].room_id!;
    await anna.postRoomMessage(roomId, "Super, danke! Wann passt es dir?");
    await ben.postRoomMessage(roomId, "Heute Abend ab 18 Uhr, komm einfach vorbei.");

    const annaRoom = anna.getStateSnapshot().rooms.find((r) => r.room_id === roomId)!;
    expect(annaRoom.messages.map((m) => m.text)).toEqual(["Super, danke! Wann passt es dir?", "Heute Abend ab 18 Uhr, komm einfach vorbei."]);

    await anna.withdraw(ask.request_id, "fulfilled");
    expect(anna.getStateSnapshot().asks[0].state).toBe("withdrawn");

    void annaStore;
  });
});

describe("Daemon lifecycle — I3 indistinguishable No", () => {
  it("no-match and decline-before-dispatch produce byte-identical PASS envelopes", async () => {
    // Scenario A: no match at all (Ben has nothing related).
    const a = await setupDuo({ statusDelayMs: 2000 });
    await a.anna.sendAsk("Hat wer ein Stand-Up-Paddle?");
    await a.scheduler.advance(2000);
    const passA = a.sent.find((s) => s.env.type === "STATUS")!.env;

    // Scenario B: Ben HAS a matching item but declines before the uniform delay fires.
    const b = await setupDuo({ statusDelayMs: 2000 });
    b.benStore.putItem(SCREWDRIVER);
    await b.anna.sendAsk("Hat wer in meiner Nähe einen Akkuschrauber?");
    const benState = b.ben.getStateSnapshot();
    await b.ben.decline(benState.consent_cards[0].card_id);
    await b.scheduler.advance(2000);
    const passB = b.sent.find((s) => s.env.type === "STATUS")!.env;

    // Force identical request_id/ts so the only thing under test is the BODY shape.
    const normalize = (env: typeof passA) => serializeEnvelope({ ...env, request_id: "00000000-0000-4000-8000-000000000000", ts: "2026-01-01T00:00:02.000Z" });
    expect(normalize(passA)).toBe(normalize(passB));
    expect(JSON.parse(normalize(passA)).body).toEqual({ state: "PASS" });

    expect(a.anna.getStateSnapshot().asks[0].state).toBe("no_one_this_time");
    expect(b.anna.getStateSnapshot().asks[0].state).toBe("no_one_this_time");
  });

  it("decline AFTER the uniform PENDING has dispatched sends nothing further (silence, not a second message)", async () => {
    const { scheduler, anna, ben, benStore, sent } = await setupDuo({ statusDelayMs: 2000, defaultAskTtlMs: 5000 });
    benStore.putItem(SCREWDRIVER);

    const ask = await anna.sendAsk("Hat wer in meiner Nähe einen Akkuschrauber?");
    await scheduler.advance(2000); // PENDING dispatches
    expect(sent.some((s) => s.env.type === "STATUS")).toBe(true);
    expect(anna.getStateSnapshot().asks[0].state).toBe("waiting"); // I2: PENDING never promotes past "waiting"

    const sentCountAfterPending = sent.length;
    const benState = ben.getStateSnapshot();
    await ben.decline(benState.consent_cards[0].card_id);
    expect(sent.length).toBe(sentCountAfterPending); // decline-after-dispatch: silence, no new wire message

    await scheduler.advance(3000); // let the ask's TTL elapse
    expect(anna.getStateSnapshot().asks[0].state).toBe("no_one_this_time");
    void ask;
  });
});

describe("Daemon lifecycle — auto_forward", () => {
  it("still sends STATUS(PENDING) first, then auto-CONSENT + INTRO, without a human decision", async () => {
    const { scheduler, anna, ben, benStore, sent } = await setupDuo({ statusDelayMs: 2000 });
    benStore.putItem(
      benItem({
        id: "screwdriver",
        labels: ["Bosch IXO cordless screwdriver", "Akkuschrauber"],
        description: "Small cordless screwdriver, barely used.",
        policy: { mode: "auto_forward" },
      })
    );

    await anna.sendAsk("Hat wer in meiner Nähe einen Akkuschrauber?");
    await scheduler.advance(2000);

    const types = sent.map((s) => s.env.type);
    expect(types.indexOf("STATUS")).toBeLessThan(types.indexOf("CONSENT"));
    expect(types).toContain("INTRO");
    expect(anna.getStateSnapshot().asks[0].state).toBe("room_open");
  });
});

describe("Daemon lifecycle — withdrawn asker-side cancels the owner's consent card", () => {
  it("marks a pending consent card inactive on WITHDRAWN, and neither side treats it as consented", async () => {
    const { scheduler, anna, ben, benStore } = await setupDuo({ statusDelayMs: 5000 });
    benStore.putItem(SCREWDRIVER);
    const ask = await anna.sendAsk("Hat wer in meiner Nähe einen Akkuschrauber?");

    await anna.withdraw(ask.request_id, "cancelled");
    const benState = ben.getStateSnapshot();
    expect(benState.consent_cards[0].state).toBe("inactive");

    await scheduler.advance(5000);
    expect(anna.getStateSnapshot().asks[0].state).toBe("withdrawn");
  });
});

describe("Daemon lifecycle — I2 sanitization", () => {
  it("asker-facing /api/state.asks[] and /api/audit never contain the owner's peer id or the word PENDING", async () => {
    const { scheduler, anna, ben, benStore } = await setupDuo({ statusDelayMs: 2000 });
    benStore.putItem(SCREWDRIVER);
    await anna.sendAsk("Hat wer in meiner Nähe einen Akkuschrauber?");
    await scheduler.advance(2000);

    const stateJson = JSON.stringify(anna.getStateSnapshot().asks);
    const auditJson = JSON.stringify(anna.getAudit());
    for (const blob of [stateJson, auditJson]) {
      expect(blob).not.toContain(PEERS.BEN);
      expect(blob.toUpperCase()).not.toContain("PENDING");
    }
  });
});

describe("Daemon lifecycle — TTL resolution notifies WS clients (state_changed)", () => {
  it("all-quiet case: TTL fires while still 'open' (nobody replied in time) — notifies, and /api/state then shows no_one_this_time", async () => {
    // TTL shorter than the uniform STATUS delay, so the ask's own TTL timer
    // fires before Ben's PASS ever dispatches — ask is genuinely still
    // "open" at TTL.
    const { scheduler, anna, benStore } = await setupDuo({ statusDelayMs: 10_000, defaultAskTtlMs: 2_000 });
    benStore.putItem(SCREWDRIVER);

    const changeEvents: number[] = [];
    let count = 0;
    anna.setOnChange(() => {
      count += 1;
      changeEvents.push(count);
    });

    await anna.sendAsk("Hat wer in meiner Nähe einen Akkuschrauber?");
    const countBeforeTtl = count;

    await scheduler.advance(2_000); // ask's own TTL fires; Ben's PASS (at 10s) hasn't dispatched yet

    expect(count).toBeGreaterThan(countBeforeTtl); // TTL fired a notifyChange
    expect(anna.getStateSnapshot().asks[0].state).toBe("no_one_this_time");
  });

  it("decline-after-PENDING case: TTL fires while internal_state stays 'pending' forever — still notifies, and the view degrades to no_one_this_time", async () => {
    const { scheduler, anna, ben, benStore } = await setupDuo({ statusDelayMs: 2_000, defaultAskTtlMs: 5_000 });
    benStore.putItem(SCREWDRIVER);

    const changeEvents: number[] = [];
    let count = 0;
    anna.setOnChange(() => {
      count += 1;
      changeEvents.push(count);
    });

    await anna.sendAsk("Hat wer in meiner Nähe einen Akkuschrauber?");
    await scheduler.advance(2_000); // uniform PENDING dispatches; ask internal_state -> "pending"

    const benState = ben.getStateSnapshot();
    await ben.decline(benState.consent_cards[0].card_id); // decline AFTER dispatch: I3 silence, no wire message
    expect(anna.getStateSnapshot().asks[0].state).toBe("waiting"); // still "pending" internally

    const countBeforeTtl = count;
    await scheduler.advance(3_000); // ask's TTL (5000ms total) elapses; internal_state never left "pending"

    expect(count).toBeGreaterThan(countBeforeTtl); // TTL still fired a notifyChange, even with no state mutation
    expect(anna.getStateSnapshot().asks[0].state).toBe("no_one_this_time");
  });
});

describe("Daemon lifecycle — relay two-hop consent chain (I8)", () => {
  it("Ben asks, Anna relays Timo's second_brain note, both hops consent, Ben's room includes Timo and Anna — I2-blind throughout", async () => {
    const { scheduler, ben, anna, timo, annaStore, timoStore } = await setupTrio({ statusDelayMs: 2000 });
    annaStore.putItem(ladderNote());
    timoStore.putItem(REAL_LADDER);

    const benAsksJson = () => JSON.stringify(ben.getStateSnapshot().asks);
    const benAuditJson = () => JSON.stringify(ben.getAudit());

    await ben.sendAsk("Hat wer eine 3m Leiter?");

    // Anna's matcher hit her second_brain note -> a relay consent card, requester shown = Ben.
    const annaCard = anna.getStateSnapshot().consent_cards[0];
    expect(annaCard).toBeDefined();
    expect(annaCard.kind).toBe("relay");
    expect(annaCard.requester.peer_id).toBe(PEERS.BEN);

    // I2: Ben's own view never contains Anna's or Timo's identity pre-consent.
    expect(benAsksJson()).not.toContain(PEERS.ANNA);
    expect(benAsksJson()).not.toContain(PEERS.TIMO);
    expect(benAuditJson()).not.toContain(PEERS.ANNA);
    expect(benAuditJson()).not.toContain(PEERS.TIMO);

    // Anna gives her relay consent before her own uniform delay fires — she
    // must NOT open a room herself; nothing should reach Timo yet.
    await anna.consent(annaCard.card_id);
    expect(timo.getStateSnapshot().consent_cards).toHaveLength(0);

    await scheduler.advance(2000); // Anna's uniform PENDING -> Ben, then her forwarded REQUEST -> Timo

    expect(ben.getStateSnapshot().asks[0].state).toBe("waiting");

    // Timo gets a DIRECT consent card; the requester HE sees is Anna, never Ben (I8).
    const timoCard = timo.getStateSnapshot().consent_cards[0];
    expect(timoCard).toBeDefined();
    expect(timoCard.kind).toBe("direct");
    expect(timoCard.requester.peer_id).toBe(PEERS.ANNA);

    // Still I2-blind for Ben even with a live downstream leg in flight.
    expect(benAsksJson()).not.toContain(PEERS.ANNA);
    expect(benAsksJson()).not.toContain(PEERS.TIMO);
    expect(benAuditJson()).not.toContain(PEERS.ANNA);
    expect(benAuditJson()).not.toContain(PEERS.TIMO);

    await timo.consent(timoCard.card_id);
    await scheduler.advance(2000); // Timo's uniform PENDING -> Anna, then his CONSENT+INTRO -> Anna, which Anna relays into a 3-party room.

    const benState = ben.getStateSnapshot();
    expect(benState.asks[0].state).toBe("room_open");
    const roomId = benState.asks[0].room_id;
    expect(roomId).toBeDefined();
    const room = benState.rooms.find((r) => r.room_id === roomId)!;
    const peerIds = room.peers.map((p) => p.peer_id);
    expect(peerIds).toContain(PEERS.BEN);
    expect(peerIds).toContain(PEERS.ANNA);
    expect(peerIds).toContain(PEERS.TIMO);
  });

  it("Timo declines: Ben ends no_one_this_time, and the terminal PASS Ben receives is byte-identical to a no-match PASS", async () => {
    // Scenario A: genuine no-match (Anna has nothing at all).
    const a = await setupTrio({ statusDelayMs: 2000 });
    await a.ben.sendAsk("Hat wer eine 3m Leiter?");
    await a.scheduler.advance(2000);
    const passA = a.sent.find((s) => s.to === PEERS.BEN && s.env.type === "STATUS")!.env;

    // Scenario B: relay chain, but Timo (the noted owner) declines.
    const b = await setupTrio({ statusDelayMs: 2000, defaultAskTtlMs: 10_000 });
    b.annaStore.putItem(ladderNote());
    b.timoStore.putItem(REAL_LADDER);

    await b.ben.sendAsk("Hat wer eine 3m Leiter?");
    const annaCard = b.anna.getStateSnapshot().consent_cards[0];
    await b.anna.consent(annaCard.card_id);
    await b.scheduler.advance(2000); // Anna's PENDING -> Ben; her REQUEST -> Timo.

    const timoCard = b.timo.getStateSnapshot().consent_cards[0];
    await b.timo.decline(timoCard.card_id); // declines BEFORE his own uniform delay fires

    await b.scheduler.advance(8000); // Timo's uniform PASS -> Anna; Anna forwards PASS -> Ben; Ben's own TTL elapses.

    const benStatuses = b.sent.filter((s) => s.to === PEERS.BEN && s.env.type === "STATUS");
    expect(benStatuses.length).toBeGreaterThanOrEqual(1);
    const passB = benStatuses[benStatuses.length - 1].env;

    const normalize = (env: typeof passA) =>
      serializeEnvelope({ ...env, request_id: "00000000-0000-4000-8000-000000000000", ts: "2026-01-01T00:00:02.000Z" });
    expect(normalize(passA)).toBe(normalize(passB));
    expect(JSON.parse(normalize(passA)).body).toEqual({ state: "PASS" });

    expect(a.ben.getStateSnapshot().asks[0].state).toBe("no_one_this_time");
    expect(b.ben.getStateSnapshot().asks[0].state).toBe("no_one_this_time");
  });

  it("auto_forward on the second-brain item skips Anna's card but still requires Timo's consent", async () => {
    const { scheduler, ben, anna, timo, annaStore, timoStore } = await setupTrio({ statusDelayMs: 2000 });
    annaStore.putItem(ladderNote({ mode: "auto_forward" }));
    timoStore.putItem(REAL_LADDER); // still ask_each_time (default) on Timo's own item

    await ben.sendAsk("Hat wer eine 3m Leiter?");

    // No human action needed from Anna: her card was born already consented.
    const annaCard = anna.getStateSnapshot().consent_cards[0];
    expect(annaCard.state).toBe("consented");

    await scheduler.advance(2000); // Anna's PENDING -> Ben, then auto-forwarded REQUEST -> Timo.

    expect(ben.getStateSnapshot().asks[0].state).toBe("waiting");
    const timoCard = timo.getStateSnapshot().consent_cards[0];
    expect(timoCard).toBeDefined();
    expect(timoCard.kind).toBe("direct");
    expect(timoCard.state).toBe("pending"); // Timo's own item still needs his explicit consent.

    await timo.consent(timoCard.card_id);
    await scheduler.advance(2000);

    expect(ben.getStateSnapshot().asks[0].state).toBe("room_open");
  });
});
