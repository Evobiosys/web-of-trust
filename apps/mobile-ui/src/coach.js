// @ts-check
// The coach chip — the little demo hint that surfaces at key moments.

import { $ } from "./dom.js";

/**
 * Show the coach chip. Guarded against a not-yet-mounted DOM (e.g. unit
 * tests that exercise the ApiClient without booting the full phone markup)
 * so callers — including the live client's mutation-error surface — never
 * need to check for the chip's presence themselves.
 * @param {string} html
 */
export function showCoach(html) {
  const t = $("coachText");
  if (t) t.innerHTML = html;
  const c = $("coach");
  if (c) c.style.display = "flex";
}

export function hideCoach() {
  const c = $("coach");
  if (c) c.style.display = "none";
}

/** Wire the dismiss button (once). */
export function initCoach() {
  $("coachX").onclick = hideCoach;
}
