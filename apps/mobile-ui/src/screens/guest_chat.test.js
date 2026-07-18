// @ts-check
// QR-onboarding Task 6: the self-sovereign guest's LIVE chat with the origin,
// driven against a MOCKED RelayClient (no real crypto/WebSocket/IndexedDB — the
// browser-agent integration is proven in its own package). These tests pin the
// contract: a connected guest renders a two-person thread, sends correct DM
// envelopes over its relay client, appends inbound DMs from the origin (and
// only the origin), and re-renders a persisted conversation after a reload.
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { mount } from "../test/harness.js";
import { $ } from "../dom.js";
import { state } from "../store.js";
import { beginGuestChat, __resetGuestChatForTests } from "./guest_chat.js";

const ORIGIN = "did:peer:2.Ez6MkOriginAnnaAbc";

// A Map-backed localStorage so a persisted thread survives a vi.resetModules()
// "reload": this repo's Node test runner otherwise exposes a localStorage that
// throws, and guest_chat then falls back to a module-scoped map a fresh module
// would lose — masking the very persistence the reload case asserts.
beforeAll(() => {
  const backing = new Map();
  const ls = {
    getItem: (/** @type {string} */ k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { backing.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { backing.delete(k); },
    clear: () => { backing.clear(); },
    key: (/** @type {number} */ i) => Array.from(backing.keys())[i] ?? null,
    get length() { return backing.size; },
  };
  Object.defineProperty(window, "localStorage", { value: ls, configurable: true });
});

/** A mocked relay client: records every `send`, exposes the registered inbound
 * callback so a test can simulate the origin's DMs, counts start/stop. */
function makeFakeClient() {
  const fk = {
    /** @type {Array<{ toDid: string, env: any }>} */ sent: [],
    /** @type {((fromDid: string, env: unknown) => void) | null} */ cb: null,
    started: 0,
    stopped: 0,
  };
  const client = {
    send: vi.fn(async (/** @type {string} */ toDid, /** @type {any} */ env) => { fk.sent.push({ toDid, env }); }),
    onInbound: (/** @type {(fromDid: string, env: unknown) => void} */ cb) => { fk.cb = cb; },
    start: vi.fn(async () => { fk.started += 1; }),
    stop: vi.fn(() => { fk.stopped += 1; }),
  };
  return { client, fk };
}

describe("guest chat (self-sovereign guest ↔ origin over the relay)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mount();
    __resetGuestChatForTests(ORIGIN);
  });

  it("(a) after an established connection, the chat view renders with the origin's name", () => {
    const { client } = makeFakeClient();
    beginGuestChat({ client, originDid: ORIGIN, originDisplay: "Anna", myDisplay: "Zed" });

    expect(state.screen).toBe("guestchat");
    expect($("guestChatTitle").textContent).toBe("Anna");
    // No mock people/events/offers presented as real: the tabbed app stays hidden.
    expect($("guestBubs").querySelectorAll(".bub").length).toBe(0);
  });

  it("(b) Send builds a correct DM envelope, calls relayClient.send(originDid, env), and optimistically appends a me bubble", () => {
    const { client, fk } = makeFakeClient();
    beginGuestChat({ client, originDid: ORIGIN, originDisplay: "Anna", myDisplay: "Zed" });

    const input = /** @type {HTMLInputElement} */ ($("guestDmInput"));
    input.value = "hello origin";
    $("guestDmSend").click();

    expect(client.send).toHaveBeenCalledTimes(1);
    expect(fk.sent.length).toBe(1);
    expect(fk.sent[0].toDid).toBe(ORIGIN);

    const env = fk.sent[0].env;
    expect(env.v).toBe("0.1");
    expect(env.type).toBe("DM");
    expect(env.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(typeof env.ts).toBe("string");
    // Strict body + strict envelope: exactly the daemon's DM schema, no extras.
    expect(env.body).toEqual({ text: "hello origin" });
    expect(Object.keys(env).sort()).toEqual(["body", "request_id", "ts", "type", "v"]);

    // Optimistic `me` bubble, composer cleared.
    const bubs = $("guestBubs").querySelectorAll(".bub");
    expect(bubs.length).toBe(1);
    expect(bubs[0].className).toContain("me");
    expect(bubs[0].textContent).toBe("hello origin");
    expect(input.value).toBe("");
  });

  it("(c) a simulated inbound DM from the origin appends a them bubble", () => {
    const { client, fk } = makeFakeClient();
    beginGuestChat({ client, originDid: ORIGIN, originDisplay: "Anna", myDisplay: "Zed" });

    fk.cb?.(ORIGIN, { v: "0.1", type: "DM", request_id: "r", ts: "t", body: { text: "hi Zed" } });

    const bubs = $("guestBubs").querySelectorAll(".bub");
    expect(bubs.length).toBe(1);
    expect(bubs[0].className).toContain("them");
    expect(bubs[0].textContent).toBe("hi Zed");
  });

  it("(c2) HTML-escapes untrusted inbound wire text", () => {
    const { client, fk } = makeFakeClient();
    beginGuestChat({ client, originDid: ORIGIN, originDisplay: "Anna", myDisplay: "Zed" });

    fk.cb?.(ORIGIN, { type: "DM", body: { text: "<img src=x onerror=alert(1)>" } });

    const bub = $("guestBubs").querySelector(".bub.them");
    expect(bub).not.toBeNull();
    expect(bub?.querySelector("img")).toBeNull(); // not parsed as markup
    expect(bub?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("(d) ignores an inbound from a NON-origin DID or a non-DM envelope", () => {
    const { client, fk } = makeFakeClient();
    beginGuestChat({ client, originDid: ORIGIN, originDisplay: "Anna", myDisplay: "Zed" });

    fk.cb?.("did:peer:2.SomeoneElse", { type: "DM", body: { text: "sneaky" } }); // wrong sender
    fk.cb?.(ORIGIN, { type: "CONNECT_ACK", body: { accepted: true } }); // wrong type
    fk.cb?.(ORIGIN, { type: "DM", body: {} }); // no text

    expect($("guestBubs").querySelectorAll(".bub").length).toBe(0);
  });

  it("(e) reload (fresh module + persisted history) re-renders the conversation", async () => {
    // Session one: send + receive, so the thread persists to localStorage.
    const { client, fk } = makeFakeClient();
    beginGuestChat({ client, originDid: ORIGIN, originDisplay: "Anna", myDisplay: "Zed" });

    const input = /** @type {HTMLInputElement} */ ($("guestDmInput"));
    input.value = "see you Sunday";
    $("guestDmSend").click();
    fk.cb?.(ORIGIN, { type: "DM", body: { text: "perfect" } });
    expect($("guestBubs").querySelectorAll(".bub").length).toBe(2);

    // "Reload": a genuinely fresh module instance + a fresh DOM. The persisted
    // thread must re-render (renderBubbles reads history, not module memory).
    vi.resetModules();
    const fresh = await import("./guest_chat.js");
    mount();
    const { client: client2 } = makeFakeClient();
    fresh.beginGuestChat({ client: client2, originDid: ORIGIN, originDisplay: "Anna", myDisplay: "Zed" });

    const bubs = $("guestBubs").querySelectorAll(".bub");
    expect(bubs.length).toBe(2);
    expect(bubs[0].className).toContain("me");
    expect(bubs[0].textContent).toBe("see you Sunday");
    expect(bubs[1].className).toContain("them");
    expect(bubs[1].textContent).toBe("perfect");
  });
});
