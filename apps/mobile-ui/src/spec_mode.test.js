// @ts-check
import { describe, it, expect } from "vitest";
import { mount } from "./test/harness.js";
import { ANCHORS } from "./spec_mode.js";

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

describe("spec mode", () => {
  it("toggles the badge overlay on the phone", () => {
    mount();
    expect(el("phone").getAttribute("data-spec")).not.toBe("on");
    el("specBtn").click();
    expect(el("phone").getAttribute("data-spec")).toBe("on");
    expect(el("specBtn").getAttribute("aria-pressed")).toBe("true");
  });

  it("tapping an anchored surface opens its contract sheet", () => {
    const ctx = mount();
    el("specBtn").click();
    ctx.show("discover");
    // the Gatherings|Offers segment carries DIS-1
    const anchored = /** @type {HTMLElement} */ (
      el("discover").querySelector('[data-anchor="DIS-1"]')
    );
    anchored.click();
    const sheet = el("sheet");
    expect(sheet.classList.contains("on")).toBe(true);
    expect(sheet.querySelector(".spec-sheet-id")?.textContent).toBe("DIS-1");
    expect(sheet.textContent).toContain(ANCHORS["DIS-1"].t);
  });

  it("registry stays complete (three-place rule)", () => {
    // sanity: a representative spread of anchors present
    for (const id of ["ONB-1", "CER-5", "WEB-4", "RES-4", "ACT-1", "PLC-3"]) {
      expect(ANCHORS[id]).toBeTruthy();
    }
    expect(Object.keys(ANCHORS).length).toBe(44);
  });
});
