// @ts-check
// The bottom sheet + veil, and the shared placeholder-tap ("held for a later
// pass") delegate. openSheet/closeSheet are used across every screen.

import { $ } from "./dom.js";

/** @param {string} html */
export function openSheet(html) {
  $("sheet").innerHTML = html;
  $("sheet").classList.add("on");
  $("veil").classList.add("on");
}

export function closeSheet() {
  $("sheet").classList.remove("on");
  $("veil").classList.remove("on");
}

/** @type {Record<string, string>} */
const PLC_TXT = {
  flag: "When someone causes harm in a trusted space, there will be a path that repairs rather than punishes — context-scoped, no public marks, restoration named by the people affected. It isn’t designed yet, on purpose: the community shapes it first. Spec stub: docs/70.",
  tags: "Tags will let you group your people (#dj, #facilitator…) and grant sharing permissions to a whole tag at once — atomic underneath, bulk on top. Spec stub: docs/70.",
  adv: "The Advanced path will let you hold your own twelve-word recovery verse, choose which server carries your encrypted backups, and self-host if you like. Your keys don’t change when it arrives — you upgrade in place.",
};

/** Wire the veil dismiss + the document-level placeholder delegate (once). */
export function initSheet() {
  $("veil").onclick = closeSheet;
  document.addEventListener("click", (e) => {
    const target = /** @type {Element} */ (e.target);
    const p = target.closest("[data-plc]");
    if (!p) return;
    const kind = p.getAttribute("data-plc") || "tags";
    openSheet(
      '<div class="grab"></div><h3>Held for a later pass</h3>' +
        '<div class="meta">' + (PLC_TXT[kind] || PLC_TXT.tags) + "</div>"
    );
  });
}
