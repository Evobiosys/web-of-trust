import { describe, expect, it } from "vitest";
import type { Envelope } from "@resource-web/protocol";
import { InMemoryBus, InMemoryTransport } from "./in_memory_transport.js";

function requestEnvelope(requestId: string): Envelope {
  return {
    v: "0.1",
    type: "REQUEST",
    request_id: requestId,
    ts: "2026-01-01T00:00:00.000Z",
    body: { text: "Hat wer einen Akkuschrauber?", ttl: 60_000 },
  };
}

describe("InMemoryTransport", () => {
  it("delivers a sent envelope to the addressed peer only", async () => {
    const bus = new InMemoryBus();
    const anna = new InMemoryTransport(bus);
    const ben = new InMemoryTransport(bus);
    await anna.init({ self: "@anna-agent:wot.local" });
    await ben.init({ self: "@ben-agent:wot.local" });

    const received: Array<{ from: string; env: Envelope }> = [];
    ben.onEnvelope((from, env) => received.push({ from, env }));

    const env = requestEnvelope("11111111-1111-4111-8111-111111111111");
    await anna.send("@ben-agent:wot.local", env);

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe("@anna-agent:wot.local");
    expect(received[0].env).toEqual(env);
  });

  it("throws when sending to an unregistered peer", async () => {
    const bus = new InMemoryBus();
    const anna = new InMemoryTransport(bus);
    await anna.init({ self: "@anna-agent:wot.local" });
    await expect(anna.send("@nobody:wot.local", requestEnvelope("22222222-2222-4222-8222-222222222222"))).rejects.toThrow();
  });

  it("creates a shared room and fans out room messages to other members, not the sender", async () => {
    const bus = new InMemoryBus();
    const anna = new InMemoryTransport(bus);
    const ben = new InMemoryTransport(bus);
    await anna.init({ self: "@anna-agent:wot.local" });
    await ben.init({ self: "@ben-agent:wot.local" });

    const { room_id } = await anna.createSharedRoom(["@anna-agent:wot.local", "@ben-agent:wot.local"], {
      request_id: "33333333-3333-4333-8333-333333333333",
      context_card: "Akkuschrauber for Anna",
    });

    const annaInbox: string[] = [];
    const benInbox: string[] = [];
    anna.onRoomMessage((m) => annaInbox.push(m.text));
    ben.onRoomMessage((m) => benInbox.push(m.text));

    await ben.sendRoomMessage({ room_id, from: "@ben-agent:wot.local", text: "Klar, komm vorbei!", ts: "2026-01-01T00:00:03.000Z" });

    expect(benInbox).toEqual([]); // sender does not receive its own echo
    expect(annaInbox).toEqual(["Klar, komm vorbei!"]);
  });
});
