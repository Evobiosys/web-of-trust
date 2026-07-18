// @ts-check
// The coach chip — the little demo hint that surfaces at key moments.

import { $ } from "./dom.js";

/** @param {string} html */
export function showCoach(html) {
  $("coachText").innerHTML = html;
  $("coach").style.display = "flex";
}

export function hideCoach() {
  $("coach").style.display = "none";
}

/** Wire the dismiss button (once). */
export function initCoach() {
  $("coachX").onclick = hideCoach;
}
