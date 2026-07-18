// Two-daemon, two-live-client integration flow (DoD, Task 6). Boots two real
// agent-daemons in-process over one InMemoryBus, points a live mobile-ui
// ApiClient at each, and drives the golden path end to end:
//   meet (mutual trust) → host gathering (tier-filtered) → borrow round-trip
//   with activity cards → DM both ways → real WS push (no manual refresh) →
//   withdraw flips the card.
//
// Standalone node script (not vitest) so it runs in a pure Node environment —
// no jsdom shims, real global fetch + WebSocket, real ws/sqlite in the daemon.
// Run: node test/live_integration.mjs   (from apps/mobile-ui)
import { startServer } from "@resource-web/agent-daemon/dist/api/server.js";
import { Daemon } from "@resource-web/agent-daemon/dist/daemon/daemon.js";
import { SqliteStore } from "@resource-web/agent-daemon/dist/store/sqlite_store.js";
import { InMemoryBus, InMemoryTransport } from "@resource-web/agent-daemon/dist/transport/in_memory_transport.js";
import { FakeClock, FakeScheduler } from "@resource-web/agent-daemon/dist/clock.js";
import { createApiClient } from "../src/api_client.js";
import { resetState } from "../src/store.js";

const ANNA = "@anna-agent:wot.local";
const BEN = "@ben-agent:wot.local";

class FakeEmbed { async embed(_m, input) { return input.map(() => [1, 0]); } }
class FakeChat { async chat() { throw new Error("no llm in integration"); } }

let failures = 0;
function check(label, cond) {
  const ok = !!cond;
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
}

async function bootDaemon(port, name, peerId, bus) {
  const clock = new FakeClock("2026-01-01T00:00:00.000Z");
  const store = new SqliteStore(":memory:");
  const config = {
    personaName: name, peerId, accent: "warm",
    statusDelayMs: 1000, defaultAskTtlMs: 3_600_000,
    matcher: { embedModel: "fake", chatModel: "fake", threshold: 0.6 },
  };
  const daemon = new Daemon({
    config, store, transport: new InMemoryTransport(bus),
    scheduler: new FakeScheduler(clock), clock,
    embedClient: new FakeEmbed(), chatClient: new FakeChat(),
  });
  await daemon.init();
  const server = await startServer(daemon, port);
  return { daemon, server, store };
}

/** Poll until `fn()` (may be async) is truthy, or throw after `ms`. */
async function until(label, fn, ms = 4000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > ms) throw new Error("timeout waiting for: " + label);
    await new Promise((r) => setTimeout(r, 40));
  }
}

async function main() {
  console.log("-------- live mobile-ui ↔ agent-daemon integration --------");
  resetState();
  const bus = new InMemoryBus();
  const a = await bootDaemon(45101, "Anna", ANNA, bus);
  const b = await bootDaemon(45102, "Ben", BEN, bus);

  const A = createApiClient({ mode: "live", agentUrl: "http://127.0.0.1:45101" });
  const B = createApiClient({ mode: "live", agentUrl: "http://127.0.0.1:45102" });
  A.start();
  B.start();
  await A.refresh();
  await B.refresh();

  // 1) MEET — mutual trust edge via the ceremony's addTrust ------------------
  console.log("\n[1] Meet ceremony (mutual addTrust)");
  await A.addTrust({ peer: BEN, display: "Ben" }, "Friend");
  await B.addTrust({ peer: ANNA, display: "Anna" }, "Friend");
  await until("A sees Ben", async () => { await A.refresh(); return A.getState().people.some((p) => p.n === "Ben"); });
  await until("B sees Anna", async () => { await B.refresh(); return B.getState().people.some((p) => p.n === "Anna"); });
  check("A's People + ring 1 include Ben", A.getState().people.some((p) => p.n === "Ben") && A.getState().rings.ring1.some((n) => n.n === "Ben"));
  check("B's People include Anna", B.getState().people.some((p) => p.n === "Anna"));

  // 2) HOST gathering on B → appears in A's Discover per tier ----------------
  console.log("\n[2] Host gathering (tier-filtered discovery)");
  await B.publishListing({ t: "Rooftop Dance", m: "Sat · Roof", when: "Sat 18:30", where: "Casa Verde", vis: "friends", steps: 2 });
  await B.publishListing({ t: "Inner Circle Only", m: "Fri · secret", when: "Fri 22:00", where: "hidden", vis: "close", steps: 1 });
  await until("A discovers the trusted gathering", async () => { await A.refresh(); return A.getState().events.some((e) => e.t === "Rooftop Dance"); });
  check("A sees B's trusted-tier gathering", A.getState().events.some((e) => e.t === "Rooftop Dance"));
  check("A does NOT see B's close-tier gathering (A is only a friend)", !A.getState().events.some((e) => e.t === "Inner Circle Only"));

  // 3) BORROW round-trip with activity cards --------------------------------
  console.log("\n[3] Borrow round-trip (activity cards flip through the lifecycle)");
  // Seed an offer on B directly (offers are created outside the host form).
  await fetch("http://127.0.0.1:45102/api/listings", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "offer", title: "PA speakers", description: "Warm full-range pair", tier: "trusted", steps: 1 }),
  });
  await until("A discovers the offer", async () => { await A.refresh(); return A.getState().offers.some((o) => o.t === "PA speakers"); });
  const offer = A.getState().offers.find((o) => o.t === "PA speakers");
  await A.requestBorrow(offer.id);

  await until("B sees the borrow request card", async () => { await B.refresh(); return B.getState().activity.some((x) => x.phase === "request"); });
  check("B's activity shows Anna's borrow request", B.getState().activity.some((x) => x.txt.includes("would like to borrow")));
  const reqItem = B.getState().activity.find((x) => x.phase === "request");
  await B.loanAction(reqItem.loanId, "approved");
  await until("B sees the approved card", async () => { await B.refresh(); return B.getState().activity.some((x) => x.phase === "approved"); });
  const apprItem = B.getState().activity.find((x) => x.phase === "approved");
  await B.loanAction(apprItem.loanId, "lent");

  await until("A sees the lent card", async () => { await A.refresh(); return A.getState().activity.some((x) => x.phase === "lent"); });
  check("A's activity shows Ben lent the speakers", A.getState().activity.some((x) => x.txt.includes("lent you")));
  check("A's offer flips to 'lent'", A.getState().offers.find((o) => o.t === "PA speakers")?.state === "lent");
  const lentItem = A.getState().activity.find((x) => x.phase === "lent");
  await A.loanAction(lentItem.loanId, "returned");

  await until("A sees the completion check-in", async () => { await A.refresh(); return A.getState().activity.some((x) => x.phase === "completion"); });
  await until("B sees the completion check-in", async () => { await B.refresh(); return B.getState().activity.some((x) => x.phase === "completion"); });
  check("both sides get the completion check-in card", A.getState().activity.some((x) => x.phase === "completion") && B.getState().activity.some((x) => x.phase === "completion"));
  const aComp = A.getState().activity.find((x) => x.phase === "completion");
  const bComp = B.getState().activity.find((x) => x.phase === "completion");
  await A.loanAction(aComp.loanId, "complete");
  await B.loanAction(bComp.loanId, "complete");
  await A.refresh();
  check("A's offer returns to available after completion", A.getState().offers.find((o) => o.t === "PA speakers")?.state === "available");

  // 4) DM both ways ---------------------------------------------------------
  console.log("\n[4] Direct messages both ways");
  await A.sendDm(BEN, "Bringing them Sunday");
  await until("B receives A's DM", async () => { await B.refresh(); return (B.getState().threads[ANNA] || []).some((m) => m[1] === "Bringing them Sunday"); });
  await B.sendDm(ANNA, "Perfect, thank you");
  await until("A receives B's DM", async () => { await A.refresh(); return (A.getState().threads[BEN] || []).some((m) => m[1] === "Perfect, thank you"); });
  check("B's thread with Anna carries the message", (B.getState().threads[ANNA] || []).some((m) => m[1] === "Bringing them Sunday"));
  check("A's thread with Ben carries the reply", (A.getState().threads[BEN] || []).some((m) => m[1] === "Perfect, thank you"));

  // 5) REAL PUSH PATH — daemon broadcast → real socket → normalize ----------
  // (Finding 4, DoD) Every other step above polls via `until()`, which itself
  // calls X.refresh() on each tick — that would pass even if the WS were
  // dead. This step proves the actual push path: it never calls B.refresh()
  // anywhere; B's live client must pick up the change entirely on its own,
  // via its own WS `state_changed` → refresh() → notify() chain.
  console.log("\n[5] Real push path: daemon broadcast → socket → client (no manual B.refresh())");
  let bNotified = false;
  const unsubB = B.subscribe(() => { bNotified = true; });
  await A.sendDm(BEN, "Testing the real push path — no manual refresh");
  await until(
    "B's client updates via its own WS-triggered refresh, not a manual B.refresh() call",
    () => bNotified && (B.getState().threads[ANNA] || []).some((m) => m[1] === "Testing the real push path — no manual refresh"),
    8000
  );
  unsubB();
  check("at least one store notification fired while waiting (the push actually happened, not a coincidence)", bNotified);
  check(
    "B's thread with Anna carries the DM, delivered purely by the real WS broadcast",
    (B.getState().threads[ANNA] || []).some((m) => m[1] === "Testing the real push path — no manual refresh")
  );

  // 6) WITHDRAW flips the card ----------------------------------------------
  console.log("\n[6] Withdraw flips the card");
  const bOffer = B.getState().offers.find((o) => o.t === "PA speakers");
  await B.withdrawListing(bOffer.id);
  await until("A's offer disappears after withdraw", async () => { await A.refresh(); return !A.getState().offers.some((o) => o.t === "PA speakers"); });
  check("withdrawn offer is gone from A's Discover", !A.getState().offers.some((o) => o.t === "PA speakers"));

  A.stop();
  B.stop();
  await a.server.close();
  await b.server.close();

  console.log("\n--------");
  if (failures) { console.log(`INTEGRATION FAILED — ${failures} check(s) failed`); process.exit(1); }
  console.log("INTEGRATION OK — all checks passed");
  process.exit(0);
}

main().catch((err) => { console.error("integration error:", err); process.exit(1); });
