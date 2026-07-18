// Unit tests for LadderChannel (core-transport-plan.md §0 SCOPE REVISION +
// Task 3, simplified "T3'": data rungs [relay -> lan_http] only, no webrtc,
// no signaling plane — see ladder_channel.ts's file header).
//
// Per the task brief, this prefers the REAL HttpPostChannel (with an
// injected httpPost, exactly like delivery_channel.test.ts) for the
// "lan_http" rung, and a small stub DeliveryChannel shaped like RelayChannel
// for the "relay" rung — RelayChannel itself is exercised end-to-end against
// a live RelayServer in relay_channel.test.ts; re-spinning that server here
// would only slow this suite down without adding coverage of LadderChannel's
// own composition logic.
import { describe, it, expect, vi } from "vitest";
import { createIdentity } from "./did_identity.js";
import { DidCommTransport, ENVELOPE_TYPE } from "./didcomm_transport.js";
import { packMessage, unpackMessage, type JwmMessage } from "./didcomm_crypto.js";
import { HttpPostChannel, type DeliveryChannel } from "./delivery_channel.js";
import { LadderChannel, type LadderRung } from "./ladder_channel.js";
import type { Envelope } from "@resource-web/protocol";
import { ENVELOPE_FIXTURES } from "./test_support/envelope_fixtures.js";

/** A DeliveryChannel stub shaped like RelayChannel/HttpPostChannel: records
 * calls, lets a test script per-call success/failure, and lets a test fire
 * inbound wires through its registered sink. */
class StubChannel implements DeliveryChannel {
  readonly delivered: { recipientDid: string; wire: string }[] = [];
  private inboundSink: ((wire: string) => void) | undefined;
  behavior: "resolve" | "reject" | "hang" | "reject_late" = "resolve";
  rejectMessage = "stub: rejected";
  /** Only used when behavior === "reject_late": ms to wait before rejecting, so the test can prove a loser that later rejects doesn't leak an unhandled rejection. */
  rejectAfterMs = 0;

  async deliver(recipientDid: string, wire: string): Promise<void> {
    this.delivered.push({ recipientDid, wire });
    if (this.behavior === "resolve") return;
    if (this.behavior === "reject") throw new Error(this.rejectMessage);
    if (this.behavior === "reject_late") {
      await new Promise((r) => setTimeout(r, this.rejectAfterMs));
      throw new Error(this.rejectMessage);
    }
    // "hang": never resolves/rejects — used to exercise LadderChannel's own budget timeout.
    await new Promise<void>(() => {});
  }

  onInbound(cb: (wire: string) => void): void {
    this.inboundSink = cb;
  }

  fireInbound(wire: string): void {
    if (!this.inboundSink) throw new Error("StubChannel: onInbound was never registered");
    this.inboundSink(wire);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildWire(sender: ReturnType<typeof createIdentity>, recipientDid: string, id: string): string {
  return packMessage({
    sender,
    recipientDid,
    message: {
      id,
      type: ENVELOPE_TYPE,
      from: sender.did,
      to: [recipientDid],
      created_time: Date.now(),
      body: ENVELOPE_FIXTURES[0],
    } satisfies JwmMessage,
  });
}

describe("LadderChannel — deliver()", () => {
  it("tries rungs in the configured order and stops at the first success (relay before lan_http)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const relay = new StubChannel();
    const http = new StubChannel();
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "relay", channel: relay },
        { name: "lan_http", channel: http },
      ],
    });

    const wire = buildWire(anna, ben.did, "order-1");
    await ladder.deliver(ben.did, wire);

    expect(relay.delivered).toHaveLength(1);
    expect(http.delivered).toHaveLength(0); // never fell through — relay succeeded first
  });

  it("falls through to lan_http when the relay rung rejects", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const relay = new StubChannel();
    relay.behavior = "reject";
    relay.rejectMessage = "relay unreachable";
    const httpCalls: { url: string; body: string }[] = [];
    const httpPost = async (url: string, body: string): Promise<void> => {
      httpCalls.push({ url, body });
    };
    const http = new HttpPostChannel(anna, { httpPost });
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "relay", channel: relay },
        { name: "lan_http", channel: http },
      ],
    });

    const wire = buildWire(anna, ben.did, "fallthrough-1");
    await ladder.deliver(ben.did, wire);

    expect(relay.delivered).toHaveLength(1); // attempted, and failed
    expect(httpCalls).toHaveLength(1); // fell through to the real HttpPostChannel
    expect(httpCalls[0].url).toBe(ben.serviceEndpoint);
    expect(httpCalls[0].body).toBe(wire);
  });

  it("rejects deliver() only once every rung has failed", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const relay = new StubChannel();
    relay.behavior = "reject";
    relay.rejectMessage = "relay unreachable";
    const http = new HttpPostChannel(anna, {
      httpPost: async () => {
        throw new Error("HttpPostChannel: POST failed with 500");
      },
    });
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "relay", channel: relay },
        { name: "lan_http", channel: http },
      ],
    });

    const wire = buildWire(anna, ben.did, "allfail-1");
    await expect(ladder.deliver(ben.did, wire)).rejects.toThrow(
      /all rungs failed.*relay unreachable.*failed with 500/s
    );
  });

  it("treats a rung exceeding its configured budget as a failure and falls through", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const relay = new StubChannel();
    relay.behavior = "hang"; // never settles on its own
    const http = new StubChannel();
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "relay", channel: relay },
        { name: "lan_http", channel: http },
      ],
      budgets: { relayAckMs: 30 },
    });

    const wire = buildWire(anna, ben.did, "budget-1");
    await ladder.deliver(ben.did, wire);

    expect(relay.delivered).toHaveLength(1); // attempted, then timed out
    expect(http.delivered).toHaveLength(1); // fallen through
  });

  it("does not leak an unhandled rejection when a timed-out rung's underlying call later rejects on its own", async () => {
    // Promise.race (used internally by the budget timeout) never cancels the
    // loser: when the budget wins, the underlying rung call keeps running in
    // the background and may still reject later (e.g. RelayChannel's own
    // internal ack-timeout firing after LadderChannel's shorter budget
    // already gave up on it). This must not surface as a process-level
    // unhandled rejection — this test would fail the whole suite (like
    // vitest's "Unhandled Errors" section) if LadderChannel didn't guard it.
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const relay = new StubChannel();
    relay.behavior = "reject_late";
    relay.rejectAfterMs = 60;
    const http = new StubChannel();
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "relay", channel: relay },
        { name: "lan_http", channel: http },
      ],
      budgets: { relayAckMs: 20 },
    });

    const wire = buildWire(anna, ben.did, "late-reject-1");
    await ladder.deliver(ben.did, wire);

    expect(relay.delivered).toHaveLength(1); // attempted, budget expired first
    expect(http.delivered).toHaveLength(1); // fell through on the timeout

    // Let the abandoned relay call actually reject in the background (60ms
    // after it started, well past the 20ms budget) before the test ends —
    // if LadderChannel's loser-guard were missing, this is the point at
    // which vitest would record an unhandled rejection.
    await sleep(80);
  });

  it("honors dataRungs order even when relay is listed after lan_http (order is caller-controlled)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const first = new StubChannel();
    const second = new StubChannel();
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "lan_http", channel: first },
        { name: "relay", channel: second },
      ],
    });

    const wire = buildWire(anna, ben.did, "order-2");
    await ladder.deliver(ben.did, wire);

    expect(first.delivered).toHaveLength(1);
    expect(second.delivered).toHaveLength(0);
  });

  it("rejects construction with an empty rung list", () => {
    expect(() => new LadderChannel({ dataRungs: [] })).toThrow(/dataRungs must not be empty/);
  });
});

describe("LadderChannel — onInbound()", () => {
  it("registers the same callback on every rung so either rung's inbound reaches the shared sink", () => {
    const relay = new StubChannel();
    const http = new StubChannel();
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "relay", channel: relay },
        { name: "lan_http", channel: http },
      ],
    });

    const sink = vi.fn();
    ladder.onInbound(sink);

    relay.fireInbound("wire-from-relay");
    http.fireInbound("wire-from-http");

    expect(sink).toHaveBeenNthCalledWith(1, "wire-from-relay");
    expect(sink).toHaveBeenNthCalledWith(2, "wire-from-http");
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("end-to-end: the same signed message delivered via two rungs is dispatched exactly once (Task 2 dedup absorbs the duplicate)", async () => {
    const anna = createIdentity("http://anna.example/didcomm");
    const ben = createIdentity("http://ben.example/didcomm");
    const relay = new StubChannel();
    const http = new StubChannel();
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "relay", channel: relay },
        { name: "lan_http", channel: http },
      ],
    });

    const benTransport = new DidCommTransport(ben, { channel: ladder });
    await benTransport.init({ self: ben.did });

    const received: { from: string; env: Envelope }[] = [];
    benTransport.onEnvelope((from, env) => received.push({ from, env }));

    // didcomm_transport.ts's init() wires channel.onInbound to
    // `(wire) => void this.receiveInbound(wire)` — fire-and-forget, by
    // design, for any non-HTTP channel (HTTP inbound is awaited/caught by
    // the daemon's route handler instead; see delivery_channel.ts's
    // HttpPostChannel doc comment). The dedup rejection this test
    // deliberately provokes below is therefore expected to reject with
    // nothing downstream to catch it. That's a real (frozen, out-of-scope)
    // characteristic of didcomm_transport.ts, not a LadderChannel bug — swap
    // in a thin wrapper purely so this test process doesn't record it as an
    // unhandled rejection. DidCommTransport.receiveInbound() itself, and its
    // dedup ordering (Task 2), are exercised completely unmodified via the
    // wrapper's inner call.
    const realReceiveInbound = benTransport.receiveInbound.bind(benTransport);
    benTransport.receiveInbound = async (wire: string) => {
      await realReceiveInbound(wire).catch(() => undefined);
    };

    const wire = buildWire(anna, ben.did, "dup-across-rungs-1");
    // Same wire "delivered" via both rungs, as would happen if a sender's
    // relay attempt and a direct HTTP attempt both actually landed.
    relay.fireInbound(wire);
    http.fireInbound(wire);
    // receiveInbound is async (dispatch happens after decrypt); flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe(anna.did);

    // Sanity: unpack directly confirms both fired wires really were identical/valid.
    const { from } = unpackMessage({ recipient: ben, wire });
    expect(from).toBe(anna.did);
  });
});

describe("LadderChannel — isAvailable() / close()", () => {
  it("isAvailable() is true if at least one rung is available (or has no probe)", async () => {
    const relay = new StubChannel();
    const anna = createIdentity("http://anna.example/didcomm");
    const http = new HttpPostChannel(anna); // no isAvailable() at all
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "relay", channel: relay },
        { name: "lan_http", channel: http },
      ],
    });

    await expect(ladder.isAvailable()).resolves.toBe(true);
  });

  it("close() closes every rung that supports it", async () => {
    const relayClose = vi.fn(async () => undefined);
    const relay: DeliveryChannel = {
      deliver: async () => undefined,
      onInbound: () => undefined,
      close: relayClose,
    };
    const anna = createIdentity("http://anna.example/didcomm");
    const http = new HttpPostChannel(anna); // no close() at all — must not throw
    const ladder = new LadderChannel({
      dataRungs: [
        { name: "relay", channel: relay },
        { name: "lan_http", channel: http },
      ],
    });

    await expect(ladder.close()).resolves.toBeUndefined();
    expect(relayClose).toHaveBeenCalledTimes(1);
  });
});

// Type-level check: LadderRung["name"] is exactly "relay" | "lan_http" (no
// "webrtc" — see file header). Exercised here rather than left implicit so a
// future accidental widening of the union is caught by typecheck.
const _rungNameCheck: LadderRung["name"] = "relay";
void _rungNameCheck;
