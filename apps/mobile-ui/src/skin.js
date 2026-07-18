// @ts-check
// Applies an AppProfile "skin" to the mobile-ui phone mockup: CSS
// custom-property overrides, copy overrides, and mobile-specific
// interpretations of the profile's hidden functionality. Boot code
// (main.js) calls applySkin(profile) once, after bootApp() wires the DOM
// but before the first screen renders.
//
// The ecstatic profile is deliberately a structural no-op everywhere below
// (every branch is gated on `profile.id !== "ecstatic"` or an explicit
// `profile.mobile.*` field being present) — mobile-ui's shipped appearance
// *is* the ecstatic skin, not something derived from AppProfile.theme (which
// was tuned for device-ui's independent dark-mode design system and would
// wreck this cream-and-violet phone mockup if applied literally).

import { $ } from "./dom.js";
import { state } from "./store.js";

/**
 * @typedef {import("@resource-web/app-profiles").AppProfile} AppProfile
 */

/** Tailwind-token → hex, for exactly the theme tokens the shipped profiles
 * use. Approximate (this is a demo skin, not a design-token pipeline) —
 * unknown tokens are left unmapped and simply don't override anything. */
const TAILWIND_HEX = {
  "amber-600": "#D97706",
  "amber-50": "#FFFBEB",
  "emerald-600": "#059669",
  "emerald-50": "#ECFDF5",
  "sky-700": "#0369A1",
  "slate-50": "#F8FAFC",
};

/** @param {string} token @returns {string | undefined} */
function tailwindHex(token) {
  return /** @type {Record<string, string>} */ (TAILWIND_HEX)[token];
}

const DEFAULT_ONBOARDING_HEADING = "Step onto the floor";
const DEFAULT_CELEBRATE_WORD = "Woven.";
const DEFAULT_HOST_FAB_LABEL = "＋ Host";

/** The four genre chips under Discover → Gatherings, in DOM order. The
 * first chip ("This week") is a time filter, not a genre, and is never
 * swapped by a skin. */
const GENRE_CHIP_COUNT = 4;

/** @type {string} */
let currentOnboardingHeading = DEFAULT_ONBOARDING_HEADING;

/** The onboarding welcome heading for the currently applied skin. Read by
 * screens/onboarding.js when it renders the "welcome" step, since that step
 * renders after boot (not at applySkin time — #onbInner is empty until
 * onb("welcome") runs). @returns {string} */
export function onboardingHeading() {
  return currentOnboardingHeading;
}

/** @param {AppProfile} profile */
function applyCssVars(profile) {
  if (profile.id === "ecstatic") return; // structural no-op: see file header
  const root = document.documentElement;
  const accentHex = tailwindHex(profile.theme.accent);
  const bgHex = tailwindHex(profile.theme.bg);
  if (accentHex) root.style.setProperty("--violet", accentHex);
  if (bgHex) root.style.setProperty("--linen", bgHex);
}

/** @param {AppProfile} profile */
function applyBrandHeader(profile) {
  if (profile.id === "ecstatic") return; // structural no-op: see file header
  const h1 = document.querySelector(".page-head h1");
  if (h1) h1.textContent = `${profile.brandName} — the trust prototype, in your hand`;
}

/** @param {AppProfile} profile */
function applyOnboardingHeading(profile) {
  currentOnboardingHeading = profile.id === "ecstatic" ? DEFAULT_ONBOARDING_HEADING : profile.heading;
}

/** @param {AppProfile} profile */
function applyCelebrationCopy(profile) {
  const h2 = $("celebrate").querySelector("h2");
  if (h2) h2.textContent = profile.mobile?.celebrateWord ?? DEFAULT_CELEBRATE_WORD;
}

/** @param {AppProfile} profile */
function applyHostFabLabel(profile) {
  $("hostFab").textContent = profile.mobile?.hostFabLabel ?? DEFAULT_HOST_FAB_LABEL;
}

/** @param {AppProfile} profile */
function applyDefaultMeetLevel(profile) {
  const level = profile.mobile?.defaultMeetLevel;
  if (level) state.offerLevel = level;
}

/** @param {AppProfile} profile */
function applyDiscoverDefault(profile) {
  if (profile.mobile?.discoverDefault !== "offers") return;
  $("segGath").classList.remove("on");
  $("segOff").classList.add("on");
  $("gathWrap").style.display = "none";
  $("offersWrap").style.display = "";
}

/** @param {AppProfile} profile */
function applyOfferChips(profile) {
  const chips = profile.mobile?.offerChips;
  if (!chips) return;
  const chipEls = Array.from($("discover").querySelectorAll(".chips .chip")).slice(1, 1 + GENRE_CHIP_COUNT);
  chipEls.forEach((chipEl, i) => {
    if (chips[i] !== undefined) chipEl.textContent = chips[i];
  });
}

/**
 * `hidden` panes, interpreted for mobile-ui. Neither `notes`
 * (second-brain affordances) nor `audit` has a corresponding UI surface in
 * mobile-ui today, so both are no-ops — kept explicit (not silently
 * dropped) so a future notes/audit screen has an obvious place to plug in.
 * `inventory`/`trust` are device-ui-only panes and are not interpreted here.
 * @param {AppProfile} _profile
 */
function applyHiddenPanes(_profile) {
  // no-op: see doc comment above.
}

/**
 * Applies an AppProfile's skin to the current DOM. Idempotent — safe to
 * call once per boot, before the first screen renders.
 * @param {AppProfile} profile
 */
export function applySkin(profile) {
  applyCssVars(profile);
  applyBrandHeader(profile);
  applyOnboardingHeading(profile);
  applyCelebrationCopy(profile);
  applyHostFabLabel(profile);
  applyDefaultMeetLevel(profile);
  applyDiscoverDefault(profile);
  applyOfferChips(profile);
  applyHiddenPanes(profile);
}
