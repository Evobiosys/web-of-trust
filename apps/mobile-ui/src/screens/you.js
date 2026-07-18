// @ts-check
// You screen: profile, the visibility dial, what you offer + borrowed, and the
// entry to Settings.

import { $ } from "../dom.js";
import { ctx } from "../context.js";
import { openSheet } from "../sheet.js";

export function renderYou() {
  const s = ctx.api.getState();
  const cacao = s.offers.find((o) => o.id === "cacao");
  const speakers = s.offers.find((o) => o.id === "speakers");
  const mineState = cacao && cacao.state === "available" ? "Available" : cacao ? cacao.state : "Available";
  $("youOffers").innerHTML =
    "<h3>What you offer</h3>" +
    '<p style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px">Ceremonial cacao (1kg blocks)' +
    '<span class="res-chip">' + mineState + (cacao && cacao.extended ? " · via Rafa too" : "") + "</span></p>" +
    '<button class="btn btn-ghost btn-sm" id="addRes" style="margin-top:10px;padding-left:0">＋ Offer something</button>';
  $("youBorrowed").innerHTML =
    "<h3>Borrowed by you</h3>" +
    '<p style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px">' +
    (speakers && speakers.state === "lent"
      ? "Lucía’s PA speakers<span class='res-chip loan'>bring back</span>"
      : "Nothing right now<span class='res-chip'>all returned</span>") +
    "</p>";
  $("addRes").onclick = () => {
    openSheet(
      '<div class="grab"></div><div data-anchor="RES-3"><h3>Offer something</h3>' +
        '<div class="meta">Name it, photograph it, choose its doors (same tiers as gatherings: The Commons / Friends / Close friends), and it appears to the people you chose. Mock-only in this prototype.</div></div>'
    );
  };
}

/** Wire the visibility dial + settings entry (once). */
export function initYou() {
  const dial = $("dialBtn");
  dial.onclick = () => {
    const on = dial.getAttribute("aria-pressed") === "true";
    dial.setAttribute("aria-pressed", on ? "false" : "true");
    dial.textContent = on ? "Off" : "On";
    dial.classList.toggle("btn-electric", !on);
    dial.classList.toggle("btn-ghost", on);
    ctx.api.setVisibilityDial(!on);
  };
  $("settingsBtn").onclick = () => { ctx.show("settings"); };
}
