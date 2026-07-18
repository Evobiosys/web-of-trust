// @ts-check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "../test/harness.js";
import { resetState, state } from "../store.js";
import { bootApp } from "../app.js";
import { buildConnectUrl } from "./connect_url.js";

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(here, "../../index.html"), "utf8");
const bodyMatch = indexHtml.match(/<body>([\s\S]*)<\/body>/);
const BODY = (bodyMatch ? bodyMatch[1] : "").replace(/<script[\s\S]*?<\/script>/g, "");

class NoopWebSocket {
  constructor() { this.onmessage = null; this.onclose = null; this.onerror = null; }
  close() {}
}

async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }

describe("meet ceremony", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders the share composer when opened", () => {
    const ctx = mount();
    ctx.show("meet");
    expect(el("cerInner").textContent).toContain("Add someone you just met");
    // QR channel canvas rendered (guarded getContext must not throw)
    expect(el("cerInner").querySelector("#qr")).toBeTruthy();
  });

  it("walks scan → confirm → weaving → celebration and creates the Maria edge (Friend opens the Moon Ceremony)", () => {
    const ctx = mount();
    ctx.show("meet");

    el("scanBtn").click();
    expect(el("cerInner").textContent).toContain("Point at their code");

    vi.advanceTimersByTime(500); // scan → confirm (reduced-motion = 400ms)
    expect(el("cerInner").textContent).toContain("Maria");

    // pick Friend, then confirm
    const friend = /** @type {HTMLElement} */ (
      el("cerInner").querySelector('.lvl-pill[data-l="Friend"]')
    );
    friend.click();
    el("confirmBtn").click();
    expect(el("cerInner").textContent).toContain("Weaving");

    vi.advanceTimersByTime(600); // weaving → celebration (reduced = 500ms)

    // ApiClient created the edge
    expect(state.met).toBe(true);
    expect(state.mariaLevel).toBe("Friend");
    expect(state.unlocked).toBe(true);

    // celebration screen is showing with the opened copy
    expect(el("celebrate").classList.contains("on")).toBe(true);
    expect(el("celebText").textContent).toContain("Moon Ceremony");

    // "See what opened" → the private Moon Ceremony now appears in Discover
    el("seeOpened").click();
    expect(el("discover").classList.contains("on")).toBe(true);
    expect(el("listWrap").textContent).toContain("Moon Ceremony");
  });

  it("Contact level does NOT open gated content", () => {
    const ctx = mount();
    ctx.show("meet");
    el("scanBtn").click();
    vi.advanceTimersByTime(500);
    const contact = /** @type {HTMLElement} */ (
      el("cerInner").querySelector('.lvl-pill[data-l="Contact"]')
    );
    contact.click();
    el("confirmBtn").click();
    vi.advanceTimersByTime(600);
    expect(state.met).toBe(true);
    expect(state.unlocked).toBe(false);
    expect(el("celebText").textContent).toContain("contacts");
  });
});

describe("meet ceremony — origin's connect-URL QR (Task 2, no camera)", () => {
  const card = {
    peer_id: "did:peer:2.Ez6MkAnna",
    display: "Anna",
    level_offer_default: "friend",
    did: "did:peer:2.Ez6MkAnna",
    endpoint: "http://192.168.1.42:4101/didcomm",
  };

  beforeEach(() => {
    resetState();
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, "");
      const payload = path === "/api/card"
        ? card
        : { persona: { name: "Anna" }, trust_edges: [], listings_mine: [], listings_received: [], loans: [], threads: [], consent_cards: [], steward_log: [] };
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    }));
    vi.stubGlobal("WebSocket", NoopWebSocket);
    document.body.innerHTML = BODY;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows a 'Show my connect code' disclosure whose link matches buildConnectUrl — no persona param, no camera element added", async () => {
    const ctx = bootApp({ mode: "live", agentUrl: "http://localhost:4101" });
    ctx.api.start();
    await settle();

    ctx.show("meet");
    await settle();

    const details = el("connectDetails");
    expect(details).toBeTruthy();
    expect(el("cerInner").textContent).toContain("Show my connect code");
    expect(el("cerInner").textContent).toContain(
      "Let someone new in — they point their camera here and become their own node in your web."
    );

    const expected = buildConnectUrl(window.location.origin, card, "ecstatic");
    expect(expected).not.toBeNull();
    expect(el("connectLinkText").textContent).toBe(expected);
    expect(String(expected)).not.toContain("persona=");

    // the QR itself is an SVG string (qrcode's toString renderer), not a
    // camera/video element — no getUserMedia/BarcodeDetector anywhere here.
    await settle();
    expect(el("connectQrHolder").querySelector("svg")).toBeTruthy();
    expect(el("cerInner").querySelector("video")).toBeFalsy();
  });

  it("Copy link button copies the exact connect URL", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const ctx = bootApp({ mode: "live", agentUrl: "http://localhost:4101" });
    ctx.api.start();
    await settle();
    ctx.show("meet");
    await settle();

    el("copyConnectBtn").click();
    const expected = buildConnectUrl(window.location.origin, card, "ecstatic");
    expect(writeText).toHaveBeenCalledWith(expected);
  });
});
