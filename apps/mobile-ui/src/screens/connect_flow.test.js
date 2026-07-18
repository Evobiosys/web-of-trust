// @ts-check
// QR-onboarding Task 5: the self-sovereign connect flow, driven against a
// MOCKED RelayClient + identity loader (no real crypto, WebSocket, or
// IndexedDB — the browser-agent integration is proven in its own package).
// These tests pin the contract main.js relies on: a `?connect=` device
// generates keys, sends a CONNECT to the origin, and enters (or is gently
// declined) on the origin's CONNECT_ACK.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "../test/harness.js";
import {
  runConnectFlow,
  hasEstablishedConnection,
  enterEstablishedConnection,
  __clearConnectStorageForTests,
} from "./connect_flow.js";
import { onb } from "./onboarding.js";
import { getRuntimeConfig } from "../runtime_config.js";
import { state } from "../store.js";
import { $ } from "../dom.js";

const ORIGIN = "did:peer:2.Ez6MkOriginAnnaAbc";
const RELAY = "http://192.168.1.42:4101";

/** A mocked browser-agent: records loadOrCreateIdentity calls, the created
 * relay client's options, every `send`, and exposes the registered inbound
 * callback so a test can simulate the origin's CONNECT_ACK. */
function makeFakeAgent() {
  const fk = {
    /** @type {Array<{ endpoint?: string }>} */ loadCalls: [],
    /** @type {any} */ createdOpts: null,
    started: 0,
    stopped: 0,
    /** @type {Array<{ toDid: string, envelope: any }>} */ sent: [],
    /** @type {((fromDid: string, env: unknown) => void) | null} */ cb: null,
  };
  const deps = {
    loadOrCreateIdentity: vi.fn(async (opts) => {
      fk.loadCalls.push(opts ?? {});
      return { did: "did:peer:2.BrowserSelf" };
    }),
    createRelayClient: vi.fn((opts) => {
      fk.createdOpts = opts;
      return {
        send: vi.fn(async (toDid, envelope) => { fk.sent.push({ toDid, envelope }); }),
        onInbound: (/** @type {(fromDid: string, env: unknown) => void} */ cb) => { fk.cb = cb; },
        start: vi.fn(async () => { fk.started += 1; }),
        stop: vi.fn(() => { fk.stopped += 1; }),
      };
    }),
  };
  return { deps, fk };
}

/** Build the origin's CONNECT_ACK reply the flow correlates against.
 * @param {string} requestId @param {boolean} accepted @param {string} [display] */
function ackEnv(requestId, accepted, display) {
  return {
    v: "0.1",
    type: "CONNECT_ACK",
    request_id: requestId,
    ts: new Date().toISOString(),
    body: accepted ? { accepted: true, display } : { accepted: false },
  };
}

describe("runConnectFlow (self-sovereign connect)", () => {
  beforeEach(() => {
    // The Node test runner has no working window.localStorage, so connect_flow
    // and runtime_config fall back to module-scoped in-memory stores that must
    // not leak between cases.
    __clearConnectStorageForTests();
    window.history.replaceState({}, "", "/");
  });

  it("generates browser keys (endpoint = mediator relay) and sends a CONNECT to the origin", async () => {
    mount();
    const { deps, fk } = makeFakeAgent();
    const p = runConnectFlow({ connect: ORIGIN, relay: RELAY, deps, nameProvider: async () => "Zed" });

    await vi.waitFor(() => expect(fk.sent.length).toBe(1));

    // Identity minted with the mediator relay as its service endpoint (so the
    // origin's ACK routes back through the same mediator this client drains).
    expect(deps.loadOrCreateIdentity).toHaveBeenCalledWith({ endpoint: RELAY });
    // Relay client points at the mediator base ORIGIN (it appends /relay/send).
    expect(deps.createRelayClient).toHaveBeenCalledWith(expect.objectContaining({ relayUrl: RELAY }));
    expect(fk.started).toBe(1);

    const { toDid, envelope } = fk.sent[0];
    expect(toDid).toBe(ORIGIN);
    expect(envelope.v).toBe("0.1");
    expect(envelope.type).toBe("CONNECT");
    expect(envelope.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // Strict body: exactly display + relay, nothing else (protocol .strict()).
    expect(envelope.body).toEqual({ display: "Zed", relay: RELAY });

    // Resolve the dangling flow so the test doesn't leak a pending promise.
    fk.cb?.(ORIGIN, ackEnv(envelope.request_id, true, "Anna"));
    await p;
  });

  it("CONNECT_ACK{accepted:true} → enters the app as the new profile + persists the connection", async () => {
    mount();
    const { deps, fk } = makeFakeAgent();
    const p = runConnectFlow({ connect: ORIGIN, relay: RELAY, deps, nameProvider: async () => "Zed" });
    await vi.waitFor(() => expect(fk.sent.length).toBe(1));

    fk.cb?.(ORIGIN, ackEnv(fk.sent[0].envelope.request_id, true, "Anna"));
    const res = await p;

    expect(res.accepted).toBe(true);
    // Entered the app as this self-sovereign profile.
    expect(state.name).toBe("Zed");
    expect(state.screen).toBe("discover");
    expect($("tabs").style.display).toBe("flex");
    // "Connected to <origin>" indicator carries the origin's own display name.
    expect($("coachText").innerHTML).toContain("Anna");
    // Durable connection record so a later reload re-enters directly.
    expect(hasEstablishedConnection()).toBe(true);

    // Reload path: a fresh boot (new DOM + reset store) with the persisted
    // record re-enters directly — no name step, no CONNECT re-send.
    mount();
    expect(hasEstablishedConnection()).toBe(true);
    enterEstablishedConnection();
    expect(state.name).toBe("Zed");
    expect(state.screen).toBe("discover");
  });

  it("ignores an unsolicited/mismatched CONNECT_ACK, then enters on the correlated one", async () => {
    mount();
    const { deps, fk } = makeFakeAgent();
    const p = runConnectFlow({ connect: ORIGIN, relay: RELAY, deps, nameProvider: async () => "Zed" });
    await vi.waitFor(() => expect(fk.sent.length).toBe(1));
    const reqId = fk.sent[0].envelope.request_id;

    // Wrong sender, and wrong request_id — neither must enter the app.
    fk.cb?.("did:peer:2.SomeoneElse", ackEnv(reqId, true, "Mallory"));
    fk.cb?.(ORIGIN, ackEnv("00000000-0000-4000-8000-000000000000", true, "Anna"));
    expect(state.screen).not.toBe("discover");

    // The correctly-correlated ack enters.
    fk.cb?.(ORIGIN, ackEnv(reqId, true, "Anna"));
    await p;
    expect(state.screen).toBe("discover");
  });

  it("CONNECT_ACK{accepted:false} → gentle declined screen, does NOT enter, forgets the intent", async () => {
    mount();
    // Seed a persisted connect intent (via the real runtime_config path) so we
    // can prove decline forgets it.
    window.history.replaceState({}, "", `/?connect=${ORIGIN}&relay=${encodeURIComponent(RELAY)}`);
    expect(getRuntimeConfig().connect).toBe(ORIGIN);
    window.history.replaceState({}, "", "/");

    const { deps, fk } = makeFakeAgent();
    const p = runConnectFlow({ connect: ORIGIN, relay: RELAY, deps, nameProvider: async () => "Zed" });
    await vi.waitFor(() => expect(fk.sent.length).toBe(1));

    fk.cb?.(ORIGIN, ackEnv(fk.sent[0].envelope.request_id, false));
    const res = await p;

    expect(res.accepted).toBe(false);
    expect(state.screen).not.toBe("discover");
    expect($("onbInner").innerHTML).toContain("Not this time");
    expect(hasEstablishedConnection()).toBe(false);
    // Intent forgotten so a bare reload won't re-send to an origin that said no.
    expect(getRuntimeConfig().connect).toBeUndefined();
  });

  it("a relay-unreachable send failure surfaces an error screen instead of freezing", async () => {
    mount();
    const { deps, fk } = makeFakeAgent();
    // Make the relay client's send reject (mediator down / fetch rejected).
    deps.createRelayClient = vi.fn(() => ({
      send: vi.fn(async () => { throw new Error("relay ingress unreachable"); }),
      onInbound: (/** @type {(fromDid: string, env: unknown) => void} */ cb) => { fk.cb = cb; },
      start: vi.fn(async () => {}),
      stop: vi.fn(() => {}),
    }));

    const res = await runConnectFlow({ connect: ORIGIN, relay: RELAY, deps, nameProvider: async () => "Zed" });

    expect(res.error).toBe(true);
    expect(res.accepted).toBe(false);
    expect(state.screen).not.toBe("discover");
    expect($("onbInner").innerHTML).toContain("couldn’t send your request");
    expect(hasEstablishedConnection()).toBe(false);
  });

  it("a bare no-persona, no-connect URL takes the normal-onboarding branch", () => {
    mount();
    window.history.replaceState({}, "", "/");
    const cfg = getRuntimeConfig();
    // No connect intent and no established connection → main.js falls through
    // to full onboarding.
    expect(cfg.connect).toBeUndefined();
    expect(hasEstablishedConnection()).toBe(false);

    onb("welcome");
    expect($("onbInner").innerHTML).toContain("Your identity is created here");
  });
});
