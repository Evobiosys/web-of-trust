// @ts-check
import { describe, it, expect } from "vitest";
import { mount } from "../test/harness.js";

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

describe("your web", () => {
  it("renders the rings with the ego node and ring-1 contacts", () => {
    const ctx = mount();
    ctx.show("web");
    const nodes = el("rings").querySelectorAll(".node");
    // you + Lucía + Rafa + Bruno (asym ring-2) before meeting Maria
    expect(nodes.length).toBeGreaterThanOrEqual(4);
    expect(el("rings").querySelector(".node.you")).toBeTruthy();
    // asymmetry is always labelled
    expect(el("rings").textContent).toContain("sees you: no");
    // quiet introduction suggestion is present
    expect(el("intWrap").textContent).toContain("Threads that could meet");
  });

  it("switches to the People list", () => {
    const ctx = mount();
    ctx.show("web");
    el("segPeople").click();
    const rows = el("pplList").querySelectorAll(".prow");
    expect(rows.length).toBe(3); // Lucía, Rafa, Tomás (Maria after meeting)
    expect(el("pplList").textContent).toContain("Lucía");
  });
});
