// @ts-check
// Onboarding: welcome → (quick | advanced verse/server) → name → the floor.
// Guest mode is the logged-out public browse.

import { $ } from "../dom.js";
import { state } from "../store.js";
import { ctx } from "../context.js";
import { openSheet } from "../sheet.js";
import { showCoach } from "../coach.js";
import { applyKeysCopy } from "./settings.js";
import { onboardingHeading } from "../skin.js";

const VERSE = ["fern", "tambor", "luz", "raíz", "brisa", "canto", "selva", "ámbar", "puente", "cielo", "miel", "danza"];
/** @type {Record<string, string>} */
const ONB_ANCHOR = { welcome: "ONB-1", signup: "ONB-2", verse: "ONB-3", server: "ONB-4", name: "ONB-5" };

/** @param {string} step */
export function onb(step) {
  const el = $("onbInner");
  el.setAttribute("data-anchor", ONB_ANCHOR[step]);
  if (step === "welcome") {
    el.innerHTML =
      '<svg class="foot-svg" viewBox="0 0 48 48"><path d="M20 38c-3 0-5-2.4-5-5.5 0-4.5 3-7.5 3-12C18 14 21 9 26 9s8 5.5 8 11c0 6-3.5 9-6.5 12.5C25.5 35 23 38 20 38z"/><circle cx="16" cy="15" r="1.6"/><circle cx="20" cy="12" r="1.6"/><circle cx="25" cy="10.5" r="1.4"/></svg>' +
      "<h2>" + onboardingHeading() + "</h2>" +
      "<p>Your identity is created here, on your phone. No account. No one to ask permission.</p>" +
      '<div class="signup-grid" data-anchor="ONB-2">' +
      '<button class="signup-card" id="suQuick2"><b>Quick start</b><small>Keys made and kept in this phone’s secure storage, unlocked by your face or PIN. Nothing to write down.</small></button>' +
      '<button class="signup-card" id="suAdv2" style="opacity:.55;border:2px dashed rgba(36,27,46,.3)"><b>Advanced</b><small>Your own recovery verse, server choice, open source — held for a later pass.</small></button>' +
      "</div>" +
      '<div class="actions" style="margin-top:18px"><button class="btn btn-ghost" id="onbLook">Just look around</button></div>';
    $("suQuick2").onclick = () => { state.signup = "quick"; onb("name"); };
    $("suAdv2").onclick = () => {
      openSheet(
        '<div class="grab"></div><h3>Advanced — held for later</h3>' +
          '<div class="meta">This path will let you hold your own twelve-word recovery verse, choose which server carries your encrypted backups, and read every line of the open source. The prototype ships with Quick start; nothing about your keys changes when Advanced arrives — you can upgrade in Settings.</div>'
      );
    };
    $("onbLook").onclick = guestMode;
  } else if (step === "signup") {
    el.innerHTML =
      '<span class="eyebrow">Two ways in — same web</span>' +
      "<h2>How do you want to hold your keys?</h2>" +
      '<div class="signup-grid">' +
      '<button class="signup-card" id="suQuick"><b>Quick</b><small>Your keys are made and kept in this phone’s secure storage, unlocked by your face or PIN. Nothing to write down. Ready in seconds.</small></button>' +
      '<button class="signup-card" id="suAdv"><b>Advanced</b><small>Hold your own recovery verse, choose which server carries your encrypted backups, and read the open source code.</small></button>' +
      "</div>" +
      '<p style="font-size:12px">Either way, your keys never leave your hands. You can switch later.</p>' +
      '<div class="actions"><button class="btn btn-ghost" id="onbBack">Back</button></div>';
    $("suQuick").onclick = () => { state.signup = "quick"; onb("name"); };
    $("suAdv").onclick = () => { state.signup = "advanced"; onb("verse"); };
    $("onbBack").onclick = () => { onb("welcome"); };
  } else if (step === "verse") {
    let words = "";
    for (let i = 0; i < VERSE.length; i++) words += "<span>" + (i + 1) + ". " + VERSE[i] + "</span>";
    el.innerHTML =
      '<span class="eyebrow">Your recovery verse</span>' +
      "<h2>Twelve words to keep</h2>" +
      "<p>Like a song you don’t forget. They bring your web back if this phone is ever lost. Write them somewhere real.</p>" +
      '<div class="verse-grid">' + words + "</div>" +
      '<div class="actions"><button class="btn btn-electric" id="onbNext">I have them</button></div>';
    $("onbNext").onclick = () => { onb("server"); };
  } else if (step === "server") {
    el.innerHTML =
      '<span class="eyebrow">Advanced</span>' +
      "<h2>Where do your encrypted backups live?</h2>" +
      "<p>Whichever you pick only ever sees ciphertext. You can change or run your own anytime.</p>" +
      '<div style="width:100%; margin-top:20px">' +
      '<button class="srv-row on"><span><b>Community server</b><small>Run by the collective — the easy default</small></span></button>' +
      '<button class="srv-row"><span><b>Another server</b><small>Point at any compatible instance</small></span></button>' +
      '<button class="srv-row"><span><b>Run your own</b><small>Self-host — instructions in the open source repo</small></span></button>' +
      '<button class="srv-row"><span><b>Read the source</b><small>Every line of this is public and inspectable</small></span></button>' +
      "</div>" +
      '<div class="actions"><button class="btn btn-electric" id="onbNext">Continue</button></div>';
    const rows = el.querySelectorAll(".srv-row");
    for (let r = 0; r < 3; r++) {
      const row = rows[r];
      /** @type {HTMLElement} */ (row).onclick = () => {
        for (let q = 0; q < 3; q++) rows[q].classList.remove("on");
        row.classList.add("on");
      };
    }
    $("onbNext").onclick = () => { onb("name"); };
  } else {
    el.innerHTML =
      '<span class="eyebrow">Almost there</span>' +
      "<h2>What do people call you on the floor?</h2>" +
      '<input class="name-input" id="nameIn" value="Zach" maxlength="16" aria-label="Your name">' +
      '<div class="actions"><button class="btn btn-coral" id="onbDone">Enter</button>' +
      '<button class="btn btn-ghost" id="onbBack2">Back</button></div>';
    $("onbDone").onclick = () => {
      const v = /** @type {HTMLInputElement} */ ($("nameIn")).value.trim();
      if (v) state.name = v;
      finishOnb();
    };
    $("onbBack2").onclick = () => { onb("welcome"); };
  }
}

export function finishOnb() {
  state.guest = false;
  $("joinBar").classList.remove("on");
  $("youName").textContent = state.name;
  $("youAva").textContent = state.name.charAt(0).toUpperCase();
  applyKeysCopy();
  $("tabs").style.display = "flex";
  showCoach("Demo: tap <b>Meet</b>, then “Scan theirs instead”");
  ctx.api.seed();
  ctx.show("discover");
}

export function guestMode() {
  state.guest = true;
  $("tabs").style.display = "none";
  $("joinBar").classList.add("on");
  showCoach("Browsing as a guest — the public floor only");
  ctx.show("discover");
}

/** Wire the join bar (once). */
export function initOnboarding() {
  $("joinBtn").onclick = () => {
    $("joinBar").classList.remove("on");
    ctx.show("onb");
    onb("welcome");
  };
}
