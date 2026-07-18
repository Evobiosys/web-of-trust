// Unit tests for the DeliveryChannel seam (core-transport-plan.md Task 1).
//
// Two things are covered:
// 1. DidCommTransport routes deliver()/inbound through an injected
//    DeliveryChannel instead of hard-wiring HTTP — proven with a spy channel.
//    (The behavior-preserving regression guard for the default path lives in
//    didcomm_transport.integration.test.ts, unmodified.)
// 2. HttpPostChannel itself: resolves the recipient's did:peer:2 endpoint and
//    POSTs; a non-2xx response throws; onInbound is a no-op sink (HTTP
//    inbound stays mounted separately at POST /didcomm).
import { describe, it, expect, vi, afterEach } from "vitest";
import { createIdentity } from "./did_identity.js";
import { DidCommTransport, ENVELOPE_TYPE } from "./didcomm_transport.js";
import { unpackMessage, type JwmMessage } from "./didcomm_crypto.js";
import { packMessage } from "./didcomm_crypto.js";
import { HttpPostChannel, defaultHttpPost, type DeliveryChannel } from "./delivery_channel.js";
import type { Envelope } from "@resource-web/protocol";
import { ENVELOPE_FIXTURES } from "./test_support/envelope_fixtures.js";

/** Records every deliver() call and lets a test manually fire inbound wires. */
class SpyChannel implements DeliveryChannel {
  readonly delivered: { recipientDid: string; wire: string }[] = [];
  private inboundSink: ((wire: string) => void) | undefined;

  async deliver(recipientDid: string, wire: string): Promise<void> {
    this.delivered.push({ recipientDid, wire });
  }

  onInbound(cb: (wire: string) => void): void {
    this.inboundSink = cb;
  }

  /** Test helper: simulate the channel receiving a wire from the network. */
  fireInbound(wire: string): void {
    if (!this.inboundSink) throw new Error("SpyChannel: onInbound was never registered");
    this.inboundSink(wire);
  }
}

describe("DidCommTransport + injected DeliveryChannel", () => {
  it("routes send() through the injected channel's deliver(), carrying exactly the packed message", async () => {
    const annaIdentity = createIdentity("http://anna.example/didcomm");
    const benIdentity = createIdentity("http://ben.example/didcomm");
    const channel = new SpyChannel();

    const anna = new DidCommTransport(annaIdentity, { channel });
    await anna.init({ self: annaIdentity.did });

    const envelope: Envelope = ENVELOPE_FIXTURES[0];
    await anna.send(benIdentity.did, envelope);

    expect(channel.delivered).toHaveLength(1);
    expect(channel.delivered[0].recipientDid).toBe(benIdentity.did);

    // packMessage is randomized (fresh ephemeral X25519 key + nonce per call),
    // so the wire string itself is never byte-equal across calls. What must
    // be exact is the *content* the channel receives: unpack it as Ben and
    // assert it decrypts to Anna's authenticated envelope, unmodified.
    const { from, message } = unpackMessage({ recipient: benIdentity, wire: channel.delivered[0].wire });
    expect(from).toBe(annaIdentity.did);
    expect(message.type).toBe(ENVELOPE_TYPE);
    expect(message.body).toEqual(JSON.parse(JSON.stringify(envelope)));
  });

  it("fires transport.receiveInbound (and onEnvelope listeners) when the channel emits an inbound wire", async () => {
    const annaIdentity = createIdentity("http://anna.example/didcomm");
    const benIdentity = createIdentity("http://ben.example/didcomm");
    const channel = new SpyChannel();

    const ben = new DidCommTransport(benIdentity, { channel });
    await ben.init({ self: benIdentity.did });

    const received: { from: string; env: Envelope }[] = [];
    ben.onEnvelope((from, env) => received.push({ from, env }));

    const envelope: Envelope = ENVELOPE_FIXTURES[1];
    const wire = packMessage({
      sender: annaIdentity,
      recipientDid: benIdentity.did,
      message: {
        id: "11111111-1111-4111-8111-111111111111",
        type: ENVELOPE_TYPE,
        from: annaIdentity.did,
        to: [benIdentity.did],
        created_time: Date.now(),
        body: envelope,
      } satisfies JwmMessage,
    });

    // Simulate the channel's transport receiving a wire from the network —
    // must funnel into the same receiveInbound() the HTTP path uses.
    channel.fireInbound(wire);
    // receiveInbound is async (dispatch happens after decrypt); flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe(annaIdentity.did);
    expect(received[0].env).toEqual(envelope);
  });

  it("defaults to an HttpPostChannel when no channel is supplied (back-compat opts.httpPost still honored)", async () => {
    const annaIdentity = createIdentity("http://anna.example/didcomm");
    const benIdentity = createIdentity("http://ben.example/didcomm");
    const calls: { url: string; body: string }[] = [];
    const httpPost = async (url: string, body: string): Promise<void> => {
      calls.push({ url, body });
    };

    const anna = new DidCommTransport(annaIdentity, { httpPost });
    await anna.init({ self: annaIdentity.did });
    await anna.send(benIdentity.did, ENVELOPE_FIXTURES[0]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(benIdentity.serviceEndpoint);
    // Sanity: what got POSTed is a real encrypted wire Ben can unpack.
    const { from } = unpackMessage({ recipient: benIdentity, wire: calls[0].body });
    expect(from).toBe(annaIdentity.did);
  });
});

describe("HttpPostChannel", () => {
  it("resolves the recipient's did:peer:2 service endpoint and POSTs the wire verbatim", async () => {
    const senderIdentity = createIdentity("http://sender.example/didcomm");
    const recipientIdentity = createIdentity("http://recipient.example/didcomm");
    const calls: { url: string; body: string }[] = [];
    const httpPost = async (url: string, body: string): Promise<void> => {
      calls.push({ url, body });
    };

    const channel = new HttpPostChannel(senderIdentity, { httpPost });
    await channel.deliver(recipientIdentity.did, "the-wire-string");

    expect(calls).toEqual([{ url: recipientIdentity.serviceEndpoint, body: "the-wire-string" }]);
  });

  it("throws when the injected httpPost rejects (e.g. non-2xx)", async () => {
    const senderIdentity = createIdentity("http://sender.example/didcomm");
    const recipientIdentity = createIdentity("http://recipient.example/didcomm");
    const httpPost = async (): Promise<void> => {
      throw new Error("HttpPostChannel: POST http://recipient.example/didcomm failed with 500");
    };

    const channel = new HttpPostChannel(senderIdentity, { httpPost });
    await expect(channel.deliver(recipientIdentity.did, "wire")).rejects.toThrow(/failed with 500/);
  });

  it("is a no-op on onInbound (HTTP inbound stays mounted separately at POST /didcomm)", () => {
    const identity = createIdentity("http://self.example/didcomm");
    const channel = new HttpPostChannel(identity);
    const cb = vi.fn();
    expect(() => channel.onInbound(cb)).not.toThrow();
    // No mechanism exists on this channel to ever invoke cb — registering it
    // must not, by itself, cause any dispatch.
    expect(cb).not.toHaveBeenCalled();
  });

  describe("defaultHttpPost", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("POSTs with the expected method/headers/body and resolves on 2xx", async () => {
      const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await defaultHttpPost("http://example.test/didcomm", '{"hello":"world"}');

      expect(fetchMock).toHaveBeenCalledWith(
        "http://example.test/didcomm",
        expect.objectContaining({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"hello":"world"}',
        })
      );
    });

    it("throws on a non-2xx response", async () => {
      const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(defaultHttpPost("http://example.test/didcomm", "body")).rejects.toThrow(/failed with 500/);
    });
  });
});
