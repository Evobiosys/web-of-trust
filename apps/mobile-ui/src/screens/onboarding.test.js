// @ts-check
import { describe, it, expect } from "vitest";
import { mount } from "../test/harness.js";
import { onb } from "./onboarding.js";
import { state } from "../store.js";
import { applySkin } from "../skin.js";
import { getProfile } from "@resource-web/app-profiles";

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

describe("onboarding + guest mode", () => {
  it("renders the welcome threshold with both signup paths", () => {
    mount();
    // main.js always calls applySkin before the welcome screen first renders
    // (mobile-ui's shipped default is housing, not ecstatic).
    applySkin(getProfile("housing"));
    onb("welcome");
    expect(el("onbInner").textContent).toContain(getProfile("housing").heading);
    expect(el("onbInner").querySelector("#suQuick2")).toBeTruthy();
    expect(el("onbInner").querySelector("#onbLook")).toBeTruthy();
  });

  it("guest mode hides the tabs and shows the join bar", () => {
    mount();
    onb("welcome");
    el("onbLook").click();
    expect(state.guest).toBe(true);
    expect(el("tabs").style.display).toBe("none");
    expect(el("joinBar").classList.contains("on")).toBe(true);
    expect(el("discover").classList.contains("on")).toBe(true);
    // guest browse shows the public-listings join pitch (DIS-5)
    expect(el("listWrap").querySelector('[data-anchor="DIS-5"]')).toBeTruthy();
  });

  it("finishing quick signup reveals the tabs and names You", () => {
    mount();
    onb("welcome");
    el("suQuick2").click(); // → name step
    el("onbDone").click(); // finish (default name "Zach")
    expect(state.guest).toBe(false);
    expect(state.name).toBe("Zach");
    expect(el("tabs").style.display).toBe("flex");
    expect(el("youName").textContent).toBe("Zach");
    // onboarding seeds Rafa's RES-6 activity → bell shows 1
    expect(state.activity.length).toBe(1);
    const bdg = /** @type {HTMLElement} */ (document.querySelector("[data-bdg]"));
    expect(bdg.textContent).toBe("1");
  });

  it("guest can rejoin via the join bar", () => {
    mount();
    applySkin(getProfile("housing"));
    onb("welcome");
    el("onbLook").click();
    el("joinBtn").click();
    expect(el("onb").classList.contains("on")).toBe(true);
    expect(el("onbInner").textContent).toContain(getProfile("housing").heading);
  });
});
