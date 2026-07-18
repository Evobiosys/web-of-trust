// @ts-check
import { describe, it, expect } from "vitest";
import { mount } from "./test/harness.js";
import { onb } from "./screens/onboarding.js";
import { state } from "./store.js";
import { applySkin, onboardingHeading } from "./skin.js";
import { getProfile } from "@resource-web/app-profiles";

/** @param {string} id */
const el = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

describe("applySkin", () => {
  describe("ecstatic (no-op)", () => {
    it("changes nothing user-visible versus mobile-ui's current defaults", () => {
      mount();

      // Baseline: mobile-ui's shipped defaults, asserted explicitly (not
      // just "same before/after") so a coincidental match can't mask a bug.
      applySkin(getProfile("ecstatic"));

      expect(el("segGath").classList.contains("on")).toBe(true);
      expect(el("segOff").classList.contains("on")).toBe(false);
      expect(el("gathWrap").style.display).toBe("");
      expect(el("offersWrap").style.display).toBe("none"); // unchanged from index.html
      expect(el("hostFab").textContent).toBe("＋ Host");
      expect(el("celebrate").querySelector("h2")?.textContent).toBe("Woven.");
      expect(state.offerLevel).toBe("Contact");
      expect(onboardingHeading()).toBe("Step onto the floor");

      const chips = Array.from(el("discover").querySelectorAll(".chips .chip")).map((c) => c.textContent);
      expect(chips).toEqual(["This week", "Ecstatic Dance", "Biodanza", "Contact Improv", "Hangouts"]);

      // No CSS custom-property override applied at all — mobile-ui's
      // stylesheet (not loaded in this jsdom harness) supplies the real
      // ecstatic look; skin.js must not add an inline :root override.
      const root = document.documentElement;
      expect(root.style.getPropertyValue("--violet")).toBe("");
      expect(root.style.getPropertyValue("--linen")).toBe("");
    });
  });

  describe("housing", () => {
    it("defaults Discover to the Offers segment", () => {
      mount();
      applySkin(getProfile("housing"));
      expect(el("segGath").classList.contains("on")).toBe(false);
      expect(el("segOff").classList.contains("on")).toBe(true);
      expect(el("gathWrap").style.display).toBe("none");
      expect(el("offersWrap").style.display).not.toBe("none");
    });

    it("swaps the genre chips for housing chips, keeping the This-week filter chip", () => {
      mount();
      applySkin(getProfile("housing"));
      const chips = Array.from(el("discover").querySelectorAll(".chips .chip")).map((c) => c.textContent);
      expect(chips).toEqual(["This week", "Room free", "Couch", "Short stay", "Longer stay"]);
    });

    it("relabels the Host FAB", () => {
      mount();
      applySkin(getProfile("housing"));
      expect(el("hostFab").textContent).toBe("＋ Offer housing");
    });

    it("overrides the accent and background CSS custom properties", () => {
      mount();
      applySkin(getProfile("housing"));
      const root = document.documentElement;
      expect(root.style.getPropertyValue("--violet")).not.toBe("");
      expect(root.style.getPropertyValue("--linen")).not.toBe("");
    });
  });

  describe("family", () => {
    it("defaults the Meet ceremony's offered level to Close friend", () => {
      mount();
      applySkin(getProfile("family"));
      expect(state.offerLevel).toBe("Close friend");
    });
  });

  describe("business", () => {
    it("defaults the Meet ceremony's offered level to Contact and sobers the celebration copy", () => {
      mount();
      applySkin(getProfile("business"));
      expect(state.offerLevel).toBe("Contact");
      expect(el("celebrate").querySelector("h2")?.textContent).toBe("Connected.");
    });
  });

  describe("onboarding heading integration", () => {
    it("housing's skinned onboarding heading reaches the welcome screen", () => {
      mount();
      applySkin(getProfile("housing"));
      onb("welcome");
      expect(el("onbInner").querySelector("h2")?.textContent).toBe(getProfile("housing").heading);
    });

    it("ecstatic keeps the original onboarding heading", () => {
      mount();
      applySkin(getProfile("ecstatic"));
      onb("welcome");
      expect(el("onbInner").querySelector("h2")?.textContent).toBe("Step onto the floor");
    });
  });
});
