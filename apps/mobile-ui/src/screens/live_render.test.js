// @ts-check
// Live-mode RENDER smoke test: the seam this task exists to build — real
// daemon data (normalized bag) flowing through the actual screen render
// functions into the DOM. Boots the real phone markup with a mode:"live"
// client backed by a mocked fetch snapshot, navigates every data screen, and
// asserts nothing throws and live text reaches the DOM. (The other live tests
// inspect getState() objects; none of them render.)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetState } from "../store.js";
import { bootApp } from "../app.js";
import { renderCeremony } from "./meet.js";

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(here, "../../index.html"), "utf8");
const bodyMatch = indexHtml.match(/<body>([\s\S]*)<\/body>/);
const BODY = (bodyMatch ? bodyMatch[1] : "").replace(/<script[\s\S]*?<\/script>/g, "");

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

function liveSnapshot() {
  return {
    persona: { name: "Anna", peer_id: "@anna:wot.local", accent: "warm" },
    items: [], trust_edges: [
      { peer: "@ben:wot.local", display: "Ben", level: "close", created_at: "t", expires_at: "t" },
    ],
    asks: [], consent_cards: [], rooms: [], steward_log: [],
    listings_mine: [], listings_received: [
      { listing_id: "g1", kind: "gathering", title: "Rooftop Dance", description: "party", when: "Sat", where_gated: "Roof", tier: "trusted", steps: 1, state: "active", owner_display: "Ben", created_at: "t", via: [], from_peer: "@ben:wot.local", received_at: "t" },
      { listing_id: "o1", kind: "offer", title: "PA speakers", description: "pair", tier: "trusted", steps: 1, state: "active", owner_display: "Ben", created_at: "t", via: [], from_peer: "@ben:wot.local", received_at: "t" },
    ],
    loans: [
      { loan_id: "l1", listing_id: "o1", role: "borrower", counterparty: { peer_id: "@ben:wot.local", display: "Ben" }, state: "lent", created_at: "t", updated_at: "t2" },
    ],
    threads: [
      { peer_id: "@ben:wot.local", display: "Ben", messages: [{ direction: "incoming", text: "See you Sunday", ts: "t" }] },
    ],
  };
}

class NoopWebSocket {
  constructor() { this.onmessage = null; this.onclose = null; this.onerror = null; }
  close() {}
}

async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

describe("live mode renders every screen without throwing", () => {
  beforeEach(() => {
    resetState();
    const card = { peer_id: "@anna:wot.local", display: "Anna", level_offer_default: "friend" };
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const payload = path === "/api/card" ? card : liveSnapshot();
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    }));
    vi.stubGlobal("WebSocket", NoopWebSocket);
    document.body.innerHTML = BODY;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("Discover / Web / Chat / Meet / Host / You render live data", async () => {
    const ctx = bootApp({ mode: "live", agentUrl: "http://localhost:4101" });
    ctx.api.start();
    await settle();

    ctx.show("discover");
    expect(el("listWrap").textContent).toContain("Rooftop Dance");
    el("segOff").click();
    expect(el("offersList").textContent).toContain("PA speakers");
    // the borrowed offer flipped to a loan chip from real loan state
    expect(el("offersList").textContent).toContain("Borrowed by you");

    ctx.show("web");
    expect(el("rings").querySelector(".node.you")).toBeTruthy();
    expect(el("rings").textContent).toContain("Ben");
    el("segPeople").click();
    expect(el("pplList").textContent).toContain("Ben");
    // Finding 1 (I1/honest-labeling): live has no real intro-suggestion feature
    // yet — the fixture's Rafa/Lucía suggestion must NOT render for live users.
    expect(el("intWrap").innerHTML).toBe("");
    expect(el("intWrap").textContent).not.toContain("Rafa");

    ctx.show("chat");
    expect(el("threadList").textContent).toContain("Ben");
    // the lent loan surfaces as an activity card awaiting me
    expect(el("actList").textContent).toContain("lent you");

    ctx.show("meet");
    expect(el("cerInner").textContent).toContain("Add someone you just met");
    // live meet renders the real-QR holder + copy button (not the fixture canvas)
    expect(el("cerInner").querySelector("#qrsvg")).toBeTruthy();
    expect(el("cerInner").querySelector("#copyCode")).toBeTruthy();

    ctx.show("host");
    expect(el("hostForm").textContent).toContain("Who can see this?");
    // reach names come from real trust edges (Ben is close → in every tier)
    el("hostForm").querySelectorAll(".vis-opt")[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(el("reach").textContent).toContain("Ben");

    ctx.show("you");
    expect(el("youOffers").textContent).toContain("What you offer");
  });

  it("Finding 2: live celebration copy stays honest — no fabricated venue/content, no seeOpened when nothing actually opened", async () => {
    const ctx = bootApp({ mode: "live", agentUrl: "http://localhost:4101" });
    ctx.api.start();
    await settle();

    ctx.show("meet");
    const ok = ctx.api.resolveCard(JSON.stringify({ peer_id: "@cora:wot.local", display: "Cora" }));
    expect(ok).toBe(true);
    // Jump straight to the confirm step — resolveCard already set pendingMeet.
    renderCeremony("confirm");
    const friend = /** @type {HTMLElement} */ (el("cerInner").querySelector('.lvl-pill[data-l="Friend"]'));
    friend.click();
    /** @type {HTMLButtonElement} */ (el("confirmBtn")).click();
    expect(el("cerInner").textContent).toContain("Weaving");

    await new Promise((r) => setTimeout(r, 600)); // weaving → celebration (reduced-motion = 500ms)
    await settle();

    const text = el("celebText").textContent || "";
    // Live has no privateEvent (I1) — nothing fabricated, nothing promised open.
    expect(text).not.toContain("Ecstatic Dance Palermo");
    expect(text).not.toContain("Moon Ceremony");
    expect(text).toContain("Deeper rooms open as you grow closer.");
    expect(el("seeOpened").style.display).toBe("none");
    // Pronouns: the weaving step must not assume a gender for the peer.
    expect(el("cerInner").textContent).not.toContain(" her phone");
  });

  it("Finding 2: live Contact-level celebration + coach chip never name the fixture-only Moon Ceremony", async () => {
    const ctx = bootApp({ mode: "live", agentUrl: "http://localhost:4101" });
    ctx.api.start();
    await settle();

    ctx.show("meet");
    ctx.api.resolveCard(JSON.stringify({ peer_id: "@dora:wot.local", display: "Dora" }));
    renderCeremony("confirm");
    const contact = /** @type {HTMLElement} */ (el("cerInner").querySelector('.lvl-pill[data-l="Contact"]'));
    contact.click();
    /** @type {HTMLButtonElement} */ (el("confirmBtn")).click();

    await new Promise((r) => setTimeout(r, 600));
    await settle();

    expect(el("celebText").textContent).not.toContain("Moon Ceremony");
    expect(el("coachText").innerHTML).not.toContain("Moon Ceremony");
    expect(el("seeOpened").style.display).toBe("none");
  });
});
