// @ts-check
// Task 8 (core-transport-plan.md): the meet-card scan→connect path in
// api_client_live.js. A NEW file (not an edit to api_client_live.test.js)
// per the scope guard — that file's existing addTrust/resolveCard tests are
// the regression guard proving the pre-Task-8 (no-did) card flow is
// unchanged, and stay untouched. This file re-creates the minimal
// installFetch/MockWebSocket harness that file already has, scoped to only
// what these new assertions need.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApiClient } from "./api_client.js";
import { resetState } from "./store.js";

function sampleSnapshot() {
  return {
    persona: { name: "Anna", peer_id: "did:peer:2.Vzanna.Ezanna.Sanna", accent: "warm" },
    items: [], trust_edges: [], asks: [], consent_cards: [], rooms: [], steward_log: [],
    listings_mine: [], listings_received: [], loans: [], threads: [],
  };
}

/** @returns {{ calls: Array<{method:string,path:string,body:any}>, fetchMock: any }} */
function installFetch() {
  /** @type {Array<{method:string,path:string,body:any}>} */
  const calls = [];
  const snap = sampleSnapshot();
  const card = {
    peer_id: "did:peer:2.Vzanna.Ezanna.Sanna",
    display: "Anna",
    level_offer_default: "friend",
    did: "did:peer:2.Vzanna.Ezanna.Sanna",
    endpoint: "http://anna.example/didcomm",
  };
  const fetchMock = vi.fn(async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, path, body });
    /** @type {any} */
    let payload = { ok: true };
    if (method === "GET" && path === "/api/state") payload = snap;
    else if (method === "GET" && path === "/api/card") payload = card;
    else if (path === "/api/connect") {
      payload = {
        trust_edge: { peer: body.did, display: body.display, level: body.level || "friend", created_at: "t", expires_at: "t2" },
        connection: { did: body.did, relays: body.relays || [], ice_servers: body.ice_servers, updated_at: "t" },
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

class MockWebSocket {
  /** @param {string} url */
  constructor(url) { this.url = url; this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null; }
  close() {}
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("live ApiClient — Task 8 scan→connect", () => {
  /** @type {ReturnType<typeof installFetch>} */
  let ctl;
  beforeEach(() => {
    resetState();
    ctl = installFetch();
    vi.stubGlobal("WebSocket", MockWebSocket);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function boot() {
    const api = createApiClient({ mode: "live", agentUrl: "http://localhost:4101" });
    api.start();
    await settle();
    return api;
  }

  it("resolveCard carries did/relays/ice_servers from a DIDComm meet-card onto pendingMeet.card", async () => {
    const api = await boot();
    const scanned = {
      peer_id: "did:peer:2.Vzben.Ezben.Sben",
      display: "Ben",
      did: "did:peer:2.Vzben.Ezben.Sben",
      endpoint: "http://ben.example/didcomm",
      relays: ["did:peer:2.Vzrelay1", "did:peer:2.Vzrelay2"],
      ice_servers: ["stun:relay.example.org:3478"],
    };
    const ok = api.resolveCard(JSON.stringify(scanned));
    expect(ok).toBe(true);
    const pm = /** @type {any} */ (api.getState().pendingMeet);
    expect(pm.card).toMatchObject({
      peer: scanned.did,
      did: scanned.did,
      endpoint: scanned.endpoint,
      relays: scanned.relays,
      ice_servers: scanned.ice_servers,
    });
  });

  it("resolveCard leaves relays/ice_servers undefined for a plain peer_id-only card (pre-Task-8 shape)", async () => {
    const api = await boot();
    api.resolveCard(JSON.stringify({ peer_id: "@ben-agent:wot.local", display: "Ben" }));
    const pm = /** @type {any} */ (api.getState().pendingMeet);
    expect(pm.card.did).toBeUndefined();
    expect(pm.card.relays).toBeUndefined();
  });

  it("addTrust POSTs /api/connect (not /api/trust) when the confirmed card carries a did, forwarding relays/ice_servers", async () => {
    const api = await boot();
    api.resolveCard(JSON.stringify({
      peer_id: "did:peer:2.Vzben.Ezben.Sben",
      display: "Ben",
      did: "did:peer:2.Vzben.Ezben.Sben",
      relays: ["did:peer:2.Vzrelay1"],
      ice_servers: ["stun:relay.example.org:3478"],
    }));
    const pm = /** @type {any} */ (api.getState().pendingMeet);
    await api.addTrust(pm.card, "Close friend");

    const connectPost = ctl.calls.find((c) => c.path === "/api/connect");
    expect(connectPost).toBeTruthy();
    expect(connectPost?.body).toEqual({
      did: "did:peer:2.Vzben.Ezben.Sben",
      display: "Ben",
      relays: ["did:peer:2.Vzrelay1"],
      ice_servers: ["stun:relay.example.org:3478"],
      level: "close",
    });
    // No /api/trust call for a did-bearing card — /api/connect subsumes it.
    expect(ctl.calls.some((c) => c.path === "/api/trust")).toBe(false);
    expect(api.getState().met).toBe(true);
    expect(api.getState().unlocked).toBe(true);
  });
});
