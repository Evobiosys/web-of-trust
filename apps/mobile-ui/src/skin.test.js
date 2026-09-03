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
  describe("ecstatic (keeps its own wording)", () => {
    it("shows ecstatic.world's own onboarding heading and genre chips, not mobile-ui's neutral defaults", () => {
      mount();
      applySkin(getProfile("ecstatic"));

      // Discover-tab default, host FAB, celebration word and Meet level are
      // all generic mobile-ui fallbacks ecstatic doesn't override (it isn't
      // the shipped default profile anymore, so this is no longer "the
      // no-op skin" — it just has nothing to say about these particular
      // knobs, same as any other profile that leaves them unset).
      expect(el("segGath").classList.contains("on")).toBe(true);
      expect(el("segOff").classList.contains("on")).toBe(false);
      expect(el("gathWrap").style.display).toBe("");
      expect(el("offersWrap").style.display).toBe("none"); // unchanged from index.html
      expect(el("hostFab").textContent).toBe("＋ Host");
      expect(el("celebrate").querySelector("h2")?.textContent).toBe("Woven.");
      expect(state.offerLevel).toBe("Contact");

      // These two ARE ecstatic's own wording, set explicitly on its `mobile`
      // field (packages/app-profiles/src/ecstatic.ts) — the audience it was
      // written for still sees it under ?app=ecstatic.
      expect(onboardingHeading()).toBe("Step onto the floor");
      const chips = Array.from(el("discover").querySelectorAll(".chips .chip")).map((c) => c.textContent);
      expect(chips).toEqual(["This week", "Ecstatic Dance", "Biodanza", "Contact Improv", "Hangouts"]);

      // No CSS custom-property override applied: ecstatic's theme tokens
      // (fuchsia-500/zinc-950) aren't in skin.js's TAILWIND_HEX map, so
      // mobile-ui's own stylesheet (not loaded in this jsdom harness)
      // supplies the real ecstatic look instead of an inline :root override.
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
