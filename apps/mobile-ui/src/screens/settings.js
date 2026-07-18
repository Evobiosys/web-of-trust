// @ts-check
// Settings screen: keys copy (reflects signup path), advanced placeholder,
// source link. Mostly static; only the Back button and the keys copy are wired.

import { $ } from "../dom.js";
import { state } from "../store.js";
import { ctx } from "../context.js";

/** Apply keys title/copy from the chosen signup path (called at onboarding end). */
export function applyKeysCopy() {
  $("keysCopy").innerHTML = state.signup === "advanced"
    ? "Twelve words, kept safe. They are the only way back to your web if this phone is lost. <b style='color:var(--violet-deep)'>Written down ✓</b>"
    : "Made and held in this phone’s secure storage, unlocked by your face or PIN. Want a recovery verse and server choice too? <b style='color:var(--violet-deep)'>Upgrade anytime.</b>";
  $("keysTitle").textContent = state.signup === "advanced" ? "Your recovery verse" : "Your keys";
}

/** Wire the Back button (once). */
export function initSettings() {
  $("setBack").onclick = () => { ctx.show("you"); };
}
