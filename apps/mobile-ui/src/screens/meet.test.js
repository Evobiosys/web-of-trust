// @ts-check
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "../test/harness.js";
import { state } from "../store.js";

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

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
