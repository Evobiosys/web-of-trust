// @ts-check
// Live ApiClient unit tests: mocked fetch + WS. Verifies normalization of the
// daemon snapshot into the shared state bag, each mutating method's endpoint +
// payload, and that a WS event triggers a refetch.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApiClient } from "./api_client.js";
import { resetState } from "./store.js";

/** A daemon snapshot exercising every collection the client normalizes. */
function sampleSnapshot() {
  return {
    persona: { name: "Anna", peer_id: "@anna:wot.local", accent: "warm" },
    items: [],
    trust_edges: [
      { peer: "@ben:wot.local", display: "Ben", level: "close", created_at: "t", expires_at: "t" },
      { peer: "@cora:wot.local", display: "Cora", level: "friend", created_at: "t", expires_at: "t" },
    ],
    asks: [],
    consent_cards: [
      { card_id: "c1", request_id: "r1", requester: { peer_id: "@ben:wot.local", display: "Ben" },
        text: "Anyone got a tent?", matched_item: { labels: ["tent"] }, kind: "direct", state: "pending", created_at: "t" },
    ],
    rooms: [],
    steward_log: [],
    listings_mine: [
      { listing_id: "m1", kind: "offer", title: "My drill", description: "Bosch", tier: "trusted", steps: 1, state: "active", owner_display: "Anna", created_at: "t" },
    ],
    listings_received: [
      { listing_id: "g1", kind: "gathering", title: "Rooftop Dance", description: "party", when: "Sat", where_gated: "Roof", tier: "trusted", steps: 1, state: "active", owner_display: "Ben", created_at: "t", via: [], from_peer: "@ben:wot.local", received_at: "t" },
      { listing_id: "o1", kind: "offer", title: "Speakers", description: "PA pair", tier: "trusted", steps: 1, state: "active", owner_display: "Ben", created_at: "t", via: [], from_peer: "@ben:wot.local", received_at: "t" },
    ],
    loans: [
      { loan_id: "l1", listing_id: "m1", role: "owner", counterparty: { peer_id: "@ben:wot.local", display: "Ben" }, state: "requested", created_at: "t", updated_at: "t2" },
    ],
    threads: [
      { peer_id: "@ben:wot.local", display: "Ben", messages: [{ direction: "incoming", text: "hi", ts: "t" }, { direction: "outgoing", text: "hey", ts: "t2" }] },
    ],
  };
}

/**
 * Install a mock fetch that serves GET /api/state + /api/card and records every
 * call. POSTs return a benign body. Returns the calls log + a snapshot setter.
 */
function installFetch() {
  /** @type {Array<{ method: string, path: string, body: any }>} */
  const calls = [];
  let snap = sampleSnapshot();
  const card = { peer_id: "@anna:wot.local", display: "Anna", level_offer_default: "friend" };
  const fetchMock = vi.fn(async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, path, body });
    /** @type {any} */
    let payload = { ok: true };
    if (method === "GET" && path === "/api/state") payload = snap;
    else if (method === "GET" && path === "/api/card") payload = card;
    else if (path === "/api/borrow") payload = { loan_id: "lX" };
    else if (path === "/api/listings") payload = { listing_id: "lstX" };
    else if (path === "/api/notes") payload = { item_id: "itemX" };
    else if (path === "/api/steward") payload = { reply: "Asked 2 people." };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, setSnap: (/** @type {any} */ s) => { snap = s; }, fetchMock };
}

/** Mock WebSocket capturing the last instance so tests can fire onmessage. */
/** @type {any} */
let lastWs;
class MockWebSocket {
  /** @param {string} url */
  constructor(url) { this.url = url; lastWs = this; this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null; }
  close() {}
}

/** Await queued microtasks/promises so refresh() settles. */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("live ApiClient", () => {
  /** @type {ReturnType<typeof installFetch>} */
  let ctl;
  beforeEach(() => {
    resetState();
    ctl = installFetch();
    vi.stubGlobal("WebSocket", MockWebSocket);
    lastWs = undefined;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function boot() {
    const api = createApiClient({ mode: "live", agentUrl: "http://localhost:4101" });
    api.start();
    await settle();
    return api;
  }

  it("normalizes the daemon snapshot into the state bag", async () => {
    const api = await boot();
    const s = /** @type {any} */ (api.getState());

    // offers: my offer + received offer
    expect(s.offers.map((/** @type {any} */ o) => o.t).sort()).toEqual(["My drill", "Speakers"]);
    const mine = s.offers.find((/** @type {any} */ o) => o.mine);
    expect(mine.owner).toBe("You");
    // a requested loan on my drill flips its state
    expect(mine.state).toBe("requested");

    // gatherings → events
    expect(s.events.some((/** @type {any} */ e) => e.t === "Rooftop Dance")).toBe(true);

    // people + rings from trust edges
    expect(s.people.map((/** @type {any} */ p) => p.n).sort()).toEqual(["Ben", "Cora"]);
    expect(s.rings.ring1.length).toBe(2);

    // reach names by tier: close=[Ben], friends(trusted)=[Ben,Cora], commons=all
    expect(s.reachNames.close).toEqual(["Ben"]);
    expect(s.reachNames.friends.sort()).toEqual(["Ben", "Cora"]);

    // threads normalized to [dir,text] pairs + thread list
    expect(s.threads["@ben:wot.local"]).toEqual([["them", "hi"], ["me", "hey"]]);
    expect(s.threadList[0]).toMatchObject({ id: "@ben:wot.local", n: "Ben", last: "hey" });

    // activity: owner-side loan request awaiting me + a pending consent card
    expect(s.activity.some((/** @type {any} */ a) => a.txt.includes("would like to borrow"))).toBe(true);
    expect(s.activity.some((/** @type {any} */ a) => a.txt.includes("tent"))).toBe(true);
  });

  it("addTrust POSTs /api/trust with the mapped level and sets celebration flags", async () => {
    const api = await boot();
    await api.addTrust({ peer: "@dora:wot.local", display: "Dora" }, "Close friend");
    const post = ctl.calls.find((c) => c.path === "/api/trust");
    expect(post).toBeTruthy();
    expect(post?.body).toEqual({ peer: "@dora:wot.local", display: "Dora", level: "close" });
    // flags set synchronously for the meet screen
    expect(api.getState().met).toBe(true);
    expect(api.getState().unlocked).toBe(true);
  });

  it("publishListing POSTs /api/listings mapping the host tier", async () => {
    const api = await boot();
    await api.publishListing({ t: "Sunset Dance", m: "Sat · Roof", when: "Sat", where: "Roof", vis: "friends", steps: 2 });
    const post = ctl.calls.find((c) => c.path === "/api/listings");
    expect(post?.body).toMatchObject({ kind: "gathering", title: "Sunset Dance", tier: "trusted", steps: 2, where_gated: "Roof" });
  });

  it("requestBorrow / loanAction / sendDm / addNote hit the right endpoints", async () => {
    const api = await boot();
    await api.requestBorrow("o1");
    expect(ctl.calls.find((c) => c.path === "/api/borrow")?.body).toEqual({ listing_id: "o1" });

    await api.loanAction("l1", "notyet");
    expect(ctl.calls.find((c) => c.path === "/api/loans/l1")?.body).toEqual({ state: "not_yet" });

    await api.sendDm("@ben:wot.local", "on my way");
    expect(ctl.calls.find((c) => c.path === "/api/threads/%40ben%3Awot.local/message")?.body).toEqual({ text: "on my way" });

    await api.addNote({ labels: ["ladder"], description: "3m", owner: "@ben:wot.local" });
    expect(ctl.calls.find((c) => c.path === "/api/notes")?.body).toMatchObject({ labels: ["ladder"] });
  });

  it("refetches state when a WS event arrives", async () => {
    const api = await boot();
    const before = ctl.calls.filter((c) => c.path === "/api/state").length;
    expect(lastWs).toBeTruthy();
    lastWs.onmessage({ data: JSON.stringify({ type: "state_changed" }) });
    await settle();
    const after = ctl.calls.filter((c) => c.path === "/api/state").length;
    expect(after).toBeGreaterThan(before);
  });

  it("Finding 3: a failed mutation surfaces a dismissible error and logs the detail, without throwing", async () => {
    document.body.innerHTML = '<div class="coach" id="coach" style="display:none"><span id="coachText"></span><button id="coachX"></button></div>';
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const api = await boot();

    // Force the next request (the /api/trust POST below) to fail at the daemon.
    ctl.fetchMock.mockImplementationOnce(async () => (
      { ok: false, status: 500, text: async () => JSON.stringify({ error: "boom" }) }
    ));

    await api.addTrust({ peer: "@x:wot.local", display: "X" }, "Friend");

    expect(errSpy).toHaveBeenCalled();
    expect(/** @type {HTMLElement} */ (document.getElementById("coach")).style.display).toBe("flex");
    expect(document.getElementById("coachText")?.textContent).toMatch(/didn.t go through/i);

    errSpy.mockRestore();
  });

  it("Finding 4: reconnects the WS with capped backoff after a close, and refetches state on every reopen", async () => {
    vi.useFakeTimers();
    try {
      const api = createApiClient({ mode: "live", agentUrl: "http://localhost:4101" });
      api.start();
      await settle();
      const ws1 = lastWs;
      expect(ws1).toBeTruthy();

      // First close: reconnect happens after the 1s base delay, not before.
      ws1.onclose();
      await vi.advanceTimersByTimeAsync(999);
      expect(lastWs).toBe(ws1); // still no new socket
      await vi.advanceTimersByTimeAsync(1);
      expect(lastWs).not.toBe(ws1); // reconnected — a new WebSocket was constructed
      const ws2 = lastWs;

      // Second close WITHOUT a successful open in between: backoff doubles (2s, not 1s again).
      ws2.onclose();
      await vi.advanceTimersByTimeAsync(1000);
      expect(lastWs).toBe(ws2); // 1s isn't enough this time
      await vi.advanceTimersByTimeAsync(1000);
      expect(lastWs).not.toBe(ws2); // reconnected at 2s
      const ws3 = lastWs;

      // A successful open resets the backoff AND triggers a refetch.
      const before = ctl.calls.filter((c) => c.path === "/api/state").length;
      ws3.onopen();
      await settle();
      const after = ctl.calls.filter((c) => c.path === "/api/state").length;
      expect(after).toBeGreaterThan(before);

      ws3.onclose();
      await vi.advanceTimersByTimeAsync(999);
      expect(lastWs).toBe(ws3); // still not reconnected at 999ms...
      await vi.advanceTimersByTimeAsync(1);
      expect(lastWs).not.toBe(ws3); // ...but is at 1s — backoff reset by the earlier onopen

      api.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolveCard parses a scanned card into pendingMeet; setVisibilityDial is client-side", async () => {
    const api = await boot();
    const ok = api.resolveCard(JSON.stringify({ peer_id: "@ben:wot.local", display: "Ben" }));
    expect(ok).toBe(true);
    expect(api.getState().pendingMeet).toMatchObject({ display: "Ben", initial: "B" });
    expect(api.resolveCard("not json")).toBe(false);

    api.setVisibilityDial(false);
    expect(api.getState().visibilityDial).toBe(false);
    // no daemon call for the dial
    expect(ctl.calls.some((c) => c.path.includes("visibil"))).toBe(false);
  });
});
