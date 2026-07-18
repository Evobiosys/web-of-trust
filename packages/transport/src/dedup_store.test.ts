// Unit tests for the DedupStore seam (core-transport-plan.md Task 2).
//
// Two layers are covered:
// 1. DedupStore implementations directly (InMemoryDedupStore, SqliteDedupStore)
//    — seen/record/prune, and (SqliteDedupStore only) survival across a
//    process restart via a real on-disk file.
// 2. DidCommTransport.receiveInbound wired to each store, proving the coupled
//    freshness-horizon-H behavior end to end: a message up to H old is now
//    accepted (was rejected under the old 5-minute REPLAY_WINDOW_MS), its
//    duplicate id is rejected, a message older than H is still rejected, a
//    future-dated message is still rejected, and — the whole point of Task 2
//    — a replayed id is still caught after a simulated daemon restart when
//    the transport is backed by SqliteDedupStore.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentity, type Identity } from "./did_identity.js";
import { DidCommTransport, ENVELOPE_TYPE } from "./didcomm_transport.js";
import { packMessage } from "./didcomm_crypto.js";
import { InMemoryDedupStore, SqliteDedupStore, MAX_HOLD_HORIZON_MS, type DedupStore } from "./dedup_store.js";
import { ENVELOPE_FIXTURES } from "./test_support/envelope_fixtures.js";
import type { DeliveryChannel } from "./delivery_channel.js";

/** No-op channel: these tests only exercise receiveInbound() directly. */
class NullChannel implements DeliveryChannel {
  async deliver(): Promise<void> {
    // never called in these tests
  }
  onInbound(): void {
    // never called in these tests
  }
}

const tempDirs: string[] = [];
function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "dedup-store-test-"));
  tempDirs.push(dir);
  return join(dir, "dedup.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 1. DedupStore implementations directly -------------------------------

describe.each([
  ["InMemoryDedupStore", () => new InMemoryDedupStore() as DedupStore],
  ["SqliteDedupStore", () => new SqliteDedupStore(makeTempDbPath()) as DedupStore],
])("%s", (_name, makeStore) => {
  it("seen() is false for an unrecorded id", () => {
    const store = makeStore();
    expect(store.seen("never-recorded")).toBe(false);
  });

  it("record() then seen() is true for that id", () => {
    const store = makeStore();
    store.record("msg-1", Date.now());
    expect(store.seen("msg-1")).toBe(true);
  });

  it("prune(now) drops entries whose created_time is older than H, keeps newer ones", () => {
    const store = makeStore();
    const now = Date.now();
    store.record("old", now - MAX_HOLD_HORIZON_MS - 1_000); // just past the horizon
    store.record("fresh", now - 1_000); // well within the horizon
    store.prune(now);
    expect(store.seen("old")).toBe(false);
    expect(store.seen("fresh")).toBe(true);
  });
});

it("SqliteDedupStore: a recorded id is still seen() by a fresh instance opened on the same path (restart survival)", () => {
  const dbPath = makeTempDbPath();
  const first = new SqliteDedupStore(dbPath);
  first.record("survives-restart", Date.now());
  first.close();

  const second = new SqliteDedupStore(dbPath);
  expect(second.seen("survives-restart")).toBe(true);
  second.close();
});

// ---- 2. DidCommTransport.receiveInbound wired to a DedupStore -------------

function buildWire(sender: Identity, recipientDid: string, id: string, createdTime: number): string {
  return packMessage({
    sender,
    recipientDid,
    message: {
      id,
      type: ENVELOPE_TYPE,
      from: sender.did,
      to: [recipientDid],
      created_time: createdTime,
      body: ENVELOPE_FIXTURES[0],
    },
  });
}

describe("DidCommTransport freshness horizon (H) + dedup, per DedupStore implementation", () => {
  for (const [name, makeStore] of [
    ["InMemoryDedupStore", () => new InMemoryDedupStore() as DedupStore],
    ["SqliteDedupStore", () => new SqliteDedupStore(makeTempDbPath()) as DedupStore],
  ] as const) {
    describe(name, () => {
      it("accepts a message created 10 minutes ago (outside the old 5-min window, inside H) exactly once, then rejects its duplicate", async () => {
        const sender = createIdentity("http://anna.example/didcomm");
        const recipient = createIdentity("http://ben.example/didcomm");
        const transport = new DidCommTransport(recipient, { channel: new NullChannel(), dedup: makeStore() });
        await transport.init({ self: recipient.did });

        const received: unknown[] = [];
        transport.onEnvelope((_from, env) => received.push(env));

        const tenMinutesAgo = Date.now() - 10 * 60_000;
        const wire = buildWire(sender, recipient.did, "ten-min-old", tenMinutesAgo);

        await transport.receiveInbound(wire); // accepted
        expect(received).toHaveLength(1);

        await expect(transport.receiveInbound(wire)).rejects.toThrow(/duplicate message id/);
        expect(received).toHaveLength(1); // no second dispatch
      });

      it("rejects a message older than H", async () => {
        const sender = createIdentity("http://anna.example/didcomm");
        const recipient = createIdentity("http://ben.example/didcomm");
        const transport = new DidCommTransport(recipient, { channel: new NullChannel(), dedup: makeStore() });
        await transport.init({ self: recipient.did });

        const tooOld = Date.now() - MAX_HOLD_HORIZON_MS - 60_000;
        const wire = buildWire(sender, recipient.did, "too-old", tooOld);

        await expect(transport.receiveInbound(wire)).rejects.toThrow(/max-hold horizon/);
      });

      it("rejects a future-dated message", async () => {
        const sender = createIdentity("http://anna.example/didcomm");
        const recipient = createIdentity("http://ben.example/didcomm");
        const transport = new DidCommTransport(recipient, { channel: new NullChannel(), dedup: makeStore() });
        await transport.init({ self: recipient.did });

        const future = Date.now() + 5 * 60_000;
        const wire = buildWire(sender, recipient.did, "future-dated", future);

        await expect(transport.receiveInbound(wire)).rejects.toThrow(/in the future/);
      });
    });
  }

  it("replay survives a transport restart when backed by SqliteDedupStore: record → new transport instance on the same dedup file → duplicate id still rejected", async () => {
    const sender = createIdentity("http://anna.example/didcomm");
    const recipient = createIdentity("http://ben.example/didcomm");
    const dbPath = makeTempDbPath();

    const wire = buildWire(sender, recipient.did, "restart-replay", Date.now() - 10 * 60_000);

    // "Before restart": first transport instance, its own SqliteDedupStore handle.
    const dedupBefore = new SqliteDedupStore(dbPath);
    const transportBefore = new DidCommTransport(recipient, { channel: new NullChannel(), dedup: dedupBefore });
    await transportBefore.init({ self: recipient.did });
    await transportBefore.receiveInbound(wire); // accepted pre-restart
    dedupBefore.close(); // simulate process shutdown

    // "After restart": brand-new transport + brand-new DedupStore instance,
    // same identity, same on-disk dedup file.
    const dedupAfter = new SqliteDedupStore(dbPath);
    const transportAfter = new DidCommTransport(recipient, { channel: new NullChannel(), dedup: dedupAfter });
    await transportAfter.init({ self: recipient.did });

    const receivedAfter: unknown[] = [];
    transportAfter.onEnvelope((_from, env) => receivedAfter.push(env));

    await expect(transportAfter.receiveInbound(wire)).rejects.toThrow(/duplicate message id/);
    expect(receivedAfter).toHaveLength(0); // never dispatched post-restart — no replay hole
    dedupAfter.close();
  });
});
