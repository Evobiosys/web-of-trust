import { describe, expect, it } from "vitest";
import { ALL_PROFILES, getProfile } from "./index.js";

const REQUIRED_IDS = ["ecstatic", "housing", "family", "business"] as const;
const VALID_ICONS = ["sparkles", "home", "users", "user", "hand-heart"];
const VALID_AUDIENCES = ["private", "trusted", "wot_commons"];
const VALID_MODES = ["ask_each_time", "auto_forward"];
const VALID_HIDDEN = ["inventory", "notes", "trust", "audit"];

describe("profiles", () => {
  it("exposes exactly the four required profiles, once each", () => {
    expect(ALL_PROFILES.map((p) => p.id).sort()).toEqual([...REQUIRED_IDS].sort());
  });

  it.each(ALL_PROFILES)("profile $id has every required field populated and valid", (profile) => {
    expect(REQUIRED_IDS).toContain(profile.id);
    expect(profile.brandName.length).toBeGreaterThan(0);
    expect(profile.heading.length).toBeGreaterThan(0);
    if (profile.subheading !== undefined) {
      expect(profile.subheading.length).toBeGreaterThan(0);
    }

    expect(profile.theme.accent.length).toBeGreaterThan(0);
    expect(profile.theme.bg.length).toBeGreaterThan(0);
    expect(typeof profile.theme.isDark).toBe("boolean");

    expect(profile.suggestionGroups.length).toBeGreaterThan(0);
    for (const group of profile.suggestionGroups) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.highlight.length).toBeGreaterThan(0);
      expect(VALID_ICONS).toContain(group.icon);
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.length).toBeGreaterThan(0);
      }
    }

    expect(VALID_AUDIENCES).toContain(profile.defaultPolicy.audience);
    expect(VALID_MODES).toContain(profile.defaultPolicy.mode);

    for (const h of profile.hidden) {
      expect(VALID_HIDDEN).toContain(h);
    }

    expect(profile.quickAdds.length).toBeGreaterThan(0);
    for (const qa of profile.quickAdds) {
      expect(qa.label.length).toBeGreaterThan(0);
      expect(qa.stewardText.length).toBeGreaterThan(0);
    }
  });

  it("getProfile resolves each known id to the matching profile", () => {
    for (const id of REQUIRED_IDS) {
      expect(getProfile(id).id).toBe(id);
    }
  });

  it("getProfile falls back to housing for unknown or empty ids", () => {
    expect(getProfile("bogus").id).toBe("housing");
    expect(getProfile("").id).toBe("housing");
    expect(getProfile("Ecstatic").id).toBe("housing"); // case-sensitive, not fuzzy
  });

  it("ecstatic profile is still retrievable by id (demoted, not removed)", () => {
    expect(getProfile("ecstatic").id).toBe("ecstatic");
    expect(ALL_PROFILES.map((p) => p.id)).toContain("ecstatic");
  });

  it("ecstatic: dark theme, trusted/ask_each_time, hides only audit", () => {
    const p = getProfile("ecstatic");
    expect(p.brandName).toBe("Ecstatic World");
    expect(p.theme.isDark).toBe(true);
    expect(p.defaultPolicy).toEqual({ audience: "trusted", mode: "ask_each_time" });
    expect(p.hidden).toEqual(["audit"]);
  });

  it("housing: light theme, bilingual roof heading, trusted/ask_each_time, hides only audit", () => {
    const p = getProfile("housing");
    expect(p.brandName).toBe("Roof");
    expect(p.theme.isDark).toBe(false);
    expect(p.heading).toMatch(/Dach/);
    expect(p.heading).toMatch(/roof/i);
    expect(p.defaultPolicy).toEqual({ audience: "trusted", mode: "ask_each_time" });
    expect(p.hidden).toEqual(["audit"]);
    expect(p.quickAdds.some((qa) => /host 1.2 guests/i.test(qa.label))).toBe(true);
    expect(
      p.suggestionGroups.some((g) => g.items.some((i) => /n.chstes Wochenende in Wien/i.test(i))),
    ).toBe(true);
  });

  it("family: trusted/auto_forward (close-trust default), hides only audit", () => {
    const p = getProfile("family");
    expect(p.defaultPolicy).toEqual({ audience: "trusted", mode: "auto_forward" });
    expect(p.hidden).toEqual(["audit"]);
  });

  it("business: trusted/ask_each_time, hides notes and audit", () => {
    const p = getProfile("business");
    expect(p.defaultPolicy).toEqual({ audience: "trusted", mode: "ask_each_time" });
    expect([...p.hidden].sort()).toEqual(["audit", "notes"]);
  });

  // --- task-7: optional `mobile` skin field (additive; device-ui ignores it) ---

  it("ecstatic: mobile skin keeps its own onboarding heading and genre chips", () => {
    const m = getProfile("ecstatic").mobile;
    expect(m?.onboardingHeading).toBe("Step onto the floor");
    expect(m?.offerChips).toEqual(["Ecstatic Dance", "Biodanza", "Contact Improv", "Hangouts"]);
  });

  it("housing: mobile skin defaults Discover to Offers with housing chips and FAB label", () => {
    const m = getProfile("housing").mobile;
    expect(m?.discoverDefault).toBe("offers");
    expect(m?.offerChips).toEqual(["Room free", "Couch", "Short stay", "Longer stay"]);
    expect(m?.hostFabLabel).toBe("＋ Offer housing");
    // English-only override for mobile-ui, which has no language toggle
    // (unlike device-ui/apps/web, which read `heading` directly) — must not
    // equal the bilingual `heading` used elsewhere on this same profile.
    expect(m?.onboardingHeading).toBeTruthy();
    expect(m?.onboardingHeading).not.toBe(getProfile("housing").heading);
  });

  it("family: mobile skin defaults the Meet ceremony to Close friend", () => {
    expect(getProfile("family").mobile?.defaultMeetLevel).toBe("Close friend");
  });

  it("business: mobile skin defaults to Contact and sobers the celebration copy", () => {
    const m = getProfile("business").mobile;
    expect(m?.defaultMeetLevel).toBe("Contact");
    expect(m?.celebrateWord).toBe("Connected.");
  });
});
