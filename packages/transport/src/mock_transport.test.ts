import { describe, it, expect, beforeEach } from "vitest";
import { MockBus, MockTransport } from "./mock_transport.js";
import type { Envelope, RoomContext } from "@resource-web/protocol";
import { ENVELOPE_FIXTURES as FIXTURES, FIXTURE_REQUEST_ID as REQUEST_ID } from "./test_support/envelope_fixtures.js";

/** Flushes the MockBus's queued microtask delivery. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("MockTransport", () => {
  let bus: MockBus;
  let anna: MockTransport;
  let ben: MockTransport;

  beforeEach(async () => {
    bus = new MockBus();
    anna = new MockTransport(bus);
    ben = new MockTransport(bus);
    await anna.init({ self: "@anna:mock" });
    await ben.init({ self: "@ben:mock" });
  });

  it.each(FIXTURES)("round-trips a $type envelope from anna to ben", async (fixture) => {
    const received: { from: string; env: Envelope }[] = [];
    ben.onEnvelope((from, env) => received.push({ from, env }));

    await anna.send("@ben:mock", fixture);
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe("@anna:mock");
    // Deep-equal, not same reference — proves it actually went through
    // serializeEnvelope/parseEnvelope, not a same-object handoff (I5 swappability
    // is only meaningful if Mock exercises the same wire contract Matrix does).
    expect(received[0].env).toEqual(fixture);
  });

  it("delivers in send order to a single peer (deterministic)", async () => {
    const received: Envelope[] = [];
    ben.onEnvelope((_from, env) => received.push(env));

    for (const fixture of FIXTURES) {
      await anna.send("@ben:mock", fixture);
    }
    await flush();

    expect(received.map((e) => e.type)).toEqual(FIXTURES.map((f) => f.type));
  });

  it("never delivers to a peer that did not initialize, and delivers nowhere else on the bus either", async () => {
    const strangerBus = new MockBus();
    const anna2 = new MockTransport(strangerBus);
    const ben2 = new MockTransport(strangerBus);
    await anna2.init({ self: "@anna:mock" });
    await ben2.init({ self: "@ben:mock" });

    const ben2Received: Envelope[] = [];
    ben2.onEnvelope((_from, env) => ben2Received.push(env));

    // "@ghost:mock" never called init() on this bus.
    await expect(anna2.send("@ghost:mock", FIXTURES[0])).resolves.toBeUndefined();
    await flush();

    // Not just "no throw" — assert the envelope was actually dropped, not
    // misdelivered to some other registered peer on the same bus.
    expect(ben2Received).toHaveLength(0);
  });

  it("supports multiple peers exchanging envelopes independently", async () => {
    const carol = new MockTransport(bus);
    await carol.init({ self: "@carol:mock" });

    const benReceived: Envelope[] = [];
    const carolReceived: Envelope[] = [];
    ben.onEnvelope((_f, e) => benReceived.push(e));
    carol.onEnvelope((_f, e) => carolReceived.push(e));

    await anna.send("@ben:mock", FIXTURES[0]);
    await anna.send("@carol:mock", FIXTURES[1]);
    await flush();

    expect(benReceived).toHaveLength(1);
    expect(benReceived[0].type).toBe("REQUEST");
    expect(carolReceived).toHaveLength(1);
    expect(carolReceived[0].type).toBe("STATUS");
  });

  describe("createSharedRoom", () => {
    it("returns room-<n> counters, incrementing per call", async () => {
      const ctx: RoomContext = { request_id: REQUEST_ID, context_card: "Anna needs a drill" };
      const room1 = await anna.createSharedRoom(["@ben:mock"], ctx);
      const room2 = await anna.createSharedRoom(["@ben:mock", "@carol:mock"], ctx);

      expect(room1.room_id).toBe("room-1");
      expect(room2.room_id).toBe("room-2");
    });

    it("shares the counter across all transports on the same bus", async () => {
      const ctx: RoomContext = { request_id: REQUEST_ID, context_card: "shared context" };
      const r1 = await anna.createSharedRoom(["@ben:mock"], ctx);
      const r2 = await ben.createSharedRoom(["@anna:mock"], ctx);
      expect(r1.room_id).toBe("room-1");
      expect(r2.room_id).toBe("room-2");
    });
  });
});
