// @ts-check
import { describe, it, expect } from "vitest";
import { mount } from "../test/harness.js";
import { onb } from "./onboarding.js";
import { state } from "../store.js";

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

function join() {
  onb("welcome");
  el("suQuick2").click();
  el("onbDone").click();
}

describe("host a gathering", () => {
  it("renders the tier picker and reach", () => {
    const ctx = mount();
    join();
    ctx.show("host");
    expect(el("hostForm").textContent).toContain("Who can see this?");
    expect(el("reach").textContent).toContain("can see this right now");
    expect(el("hostForm").querySelectorAll(".vis-opt").length).toBe(4);
  });

  it("publishing adds the hosted card to Discover", () => {
    const ctx = mount();
    join();
    ctx.show("host");
    el("hostGo").click();
    expect(state.hosted).toBeTruthy();
    expect(el("discover").classList.contains("on")).toBe(true);
    // the hosted gathering appears first in the list, labelled as yours
    const first = /** @type {HTMLElement} */ (el("listWrap").querySelector(".card"));
    expect(first.textContent).toContain("Sunset Rooftop Dance");
    expect(first.textContent).toContain("you host this");
  });
});
