// @ts-check
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "../test/harness.js";
import { onb } from "./onboarding.js";
import { state } from "../store.js";

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** Drive quick signup to the floor. */
function join() {
  onb("welcome");
  el("suQuick2").click();
  el("onbDone").click();
}

describe("discover", () => {
  it("renders the public gatherings list", () => {
    const ctx = mount();
    join();
    ctx.show("discover");
    const cards = el("listWrap").querySelectorAll(".card");
    expect(cards.length).toBe(4); // EVENTS, no private until unlocked
    expect(el("listWrap").textContent).toContain("Nachbarschaftsfest Yppenplatz");
  });

  describe("borrow flow", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it("requesting an offer pushes activity and lights the bell after the lent timer", () => {
      const ctx = mount();
      join();
      ctx.show("discover");
      el("segOff").click();

      // open the first borrowable offer (speakers) and request it
      const card = /** @type {HTMLElement} */ (el("offersList").querySelector(".card"));
      card.click();
      const reqBtn = /** @type {HTMLElement} */ (document.getElementById("reqBtn"));
      expect(reqBtn.textContent).toContain("Ask to borrow");
      reqBtn.click();

      // request state is immediate; lent + activity land on the 1600ms timer
      const seeded = state.activity.length; // Rafa's RES-6 seed
      vi.advanceTimersByTime(1600);
      expect(state.activity.length).toBe(seeded + 1);
      expect(state.activity[0].txt).toContain("lent you");

      const bdg = /** @type {HTMLElement} */ (document.querySelector("[data-bdg]"));
      expect(Number(bdg.textContent)).toBeGreaterThanOrEqual(2);
    });

    it("walks the loan lifecycle returned → completion check-in → complete (RES-4/RES-5)", () => {
      const ctx = mount();
      join();
      ctx.show("discover");
      el("segOff").click();
      const card = /** @type {HTMLElement} */ (el("offersList").querySelector(".card"));
      card.click();
      /** @type {HTMLElement} */ (document.getElementById("reqBtn")).click();
      vi.advanceTimersByTime(1600); // → lent + "Mark returned" activity

      ctx.show("chat");
      // Resolve Rafa's seed first so the only open item is the loan
      const seedBtn = /** @type {HTMLElement} */ (
        el("actList").querySelectorAll(".act-row")[1].querySelector(".act-btns .btn")
      );
      seedBtn.click();

      // Mark returned → completion check-in appears (RES-5)
      const returnBtn = /** @type {HTMLElement} */ (
        el("actList").querySelector(".act-btns .btn-coral")
      );
      returnBtn.click();
      expect(el("actList").textContent).toContain("Do you feel complete?");
      expect(el("actList").textContent).toContain("Returned ✓");

      // Complete → both sides complete, offer back to available, bell clears
      const completeBtn = /** @type {HTMLElement} */ (
        el("actList").querySelector(".act-btns .btn-electric")
      );
      completeBtn.click();
      expect(el("actList").textContent).toContain("felt complete");
      const speakers = ctx.api.getState().offers.find((o) => o.id === "speakers");
      expect(speakers?.state).toBe("available");
      const bdg = /** @type {HTMLElement} */ (document.querySelector("[data-bdg]"));
      expect(bdg.textContent).toBe("0");
    });
  });
});
