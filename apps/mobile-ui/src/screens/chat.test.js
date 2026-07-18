// @ts-check
import { describe, it, expect } from "vitest";
import { mount } from "../test/harness.js";
import { onb } from "./onboarding.js";

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

function join() {
  onb("welcome");
  el("suQuick2").click();
  el("onbDone").click();
}

describe("chat", () => {
  it("lists threads and the seeded activity item", () => {
    const ctx = mount();
    join();
    ctx.show("chat");
    expect(el("threadList").textContent).toContain("Lucía");
    expect(el("actList").textContent).toContain("Rafa");
    expect(el("actList").textContent).toContain("cacao");
  });

  it("acting on the seeded activity resolves it (loanAction-free branch)", () => {
    const ctx = mount();
    join();
    ctx.show("chat");
    const shareBtn = /** @type {HTMLElement} */ (
      el("actList").querySelector(".act-btns .btn")
    );
    shareBtn.click();
    expect(el("actList").textContent).toContain("Shared ✓");
    // bell clears once nothing is waiting
    const bdg = /** @type {HTMLElement} */ (document.querySelector("[data-bdg]"));
    expect(bdg.textContent).toBe("0");
  });

  it("sends a direct message into a thread", () => {
    const ctx = mount();
    join();
    ctx.openThread("lucia", "Lucía");
    const input = /** @type {HTMLInputElement} */ (document.getElementById("dmInput"));
    input.value = "On my way";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const bubs = el("threadBubs").querySelectorAll(".bub.me");
    expect(bubs[bubs.length - 1].textContent).toBe("On my way");
    expect(ctx.api.getState().threads.lucia.some((m) => m[1] === "On my way")).toBe(true);
  });
});
