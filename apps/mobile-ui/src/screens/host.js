// @ts-check
// Host a gathering: tier picker + rings visual + advanced steps + reach list.
// hostState is transient form state, local to this screen.

import { $ } from "../dom.js";
import { ctx } from "../context.js";
import { showCoach } from "../coach.js";

/** @type {{ vis: string, steps: number, adv?: boolean }} */
const hostState = { vis: "friends", steps: 2 };

function ringsViz() {
  const v = hostState.vis;
  /** @type {Record<string, number[]>} */
  const glowMap = { pub: [1, 1, 1, 1], commons: [1, 1, 1, 0], friends: [1, 1, 0, 0], close: [1, 0, 0, 0] };
  const glow = glowMap[v];
  /** @param {number} r @param {number} on */
  function ring(r, on) {
    return '<circle cx="60" cy="60" r="' + r + '" fill="' + (on ? "rgba(79,215,160,.16)" : "none") + '"' +
      ' stroke="' + (on ? "#4FD7A0" : "rgba(36,27,46,.15)") + '" stroke-width="1.6"' + (on ? "" : ' stroke-dasharray="3 5"') + "/>";
  }
  return '<svg class="hviz" width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">' +
    ring(54, glow[3]) + ring(40, glow[2]) + ring(26, glow[1]) +
    '<circle cx="60" cy="60" r="10" fill="' + (glow[0] ? "#4FD7A0" : "rgba(36,27,46,.2)") + '"/>' +
    "</svg>";
}

function updateReach() {
  const r = $("reach");
  const s = ctx.api.getState();
  if (hostState.vis === "pub") {
    r.innerHTML = "<b>Open doors.</b> Anyone in Buenos Aires can find this.";
    return;
  }
  const names = (s.reachNames[hostState.vis] || []).slice();
  const v = s.vis.filter((x) => x.k === hostState.vis)[0];
  r.innerHTML =
    "<b>" + names.join(", ") + "</b> and " + s.reach[hostState.vis][hostState.steps] +
    " more can see this right now — " + v.t.toLowerCase() + ", within " + hostState.steps +
    " step" + (hostState.steps > 1 ? "s" : "") + " of your circle. Those who consent show by name; " +
    "the rest count privately. Everyone else: nothing exists.";
}

export function renderHost() {
  const f = $("hostForm");
  const s = ctx.api.getState();
  let visHtml = "";
  s.vis.forEach((v) => {
    visHtml += '<button class="vis-opt' + (hostState.vis === v.k ? " on" : "") + '" data-v="' + v.k + '">' +
      '<span class="dot"></span><span>' + v.t + "<small>" + v.s + "</small></span></button>";
  });
  /** @type {Record<string, string>} */
  const blurb = {
    pub: "The whole city — no web needed.",
    commons: "Everyone woven into your community’s web, however lightly.",
    friends: "Only friends or closer. For everyone else, this gathering doesn’t exist.",
    close: "Only your close friends. The quietest room.",
  };
  f.innerHTML =
    '<div data-anchor="HST-1">' +
    '<div class="fld"><label>Name</label><input id="hn" value="Sunset Rooftop Dance"></div>' +
    '<div class="fld"><label>When</label><input id="hw" value="Sat 18:30"></div>' +
    '<div class="fld"><label>Where</label><input id="hp" value="Roof of Casa Verde — shared on arrival"></div>' +
    "</div>" +
    '<div data-anchor="HST-2">' +
    '<p class="eyebrow" style="margin:16px 0 8px">Who can see this?</p>' +
    ringsViz() + visHtml +
    '<p style="font-size:12px;color:var(--ink-soft);margin:2px 4px 0">' + blurb[hostState.vis] + "</p>" +
    "</div>" +
    '<div class="reach" id="reach" data-anchor="HST-4"></div>' +
    '<button class="adv-link" id="hostAdv" data-anchor="HST-3" style="color:var(--electric-deep)">' +
    (hostState.adv ? "Hide advanced" : "Advanced: how far through the web") + "</button>" +
    (hostState.adv
      ? '<div class="stepper" style="margin-top:10px"><button id="stDown">−</button><b id="stVal">' + hostState.steps + "</b>" +
        '<span style="font-size:13px;color:var(--ink-soft)">steps from your circle — how many handshakes away the doors reach</span><button id="stUp">＋</button></div>'
      : "") +
    '<button class="btn btn-coral" style="width:100%;margin-top:14px" id="hostGo" data-anchor="HST-5">Open the doors</button>' +
    '<button class="btn btn-ghost" style="width:100%" id="hostCancel">Cancel</button>';

  const opts = f.querySelectorAll(".vis-opt");
  opts.forEach((opt) => {
    /** @type {HTMLElement} */ (opt).onclick = () => {
      hostState.vis = opt.getAttribute("data-v") || "friends";
      renderHost();
    };
  });
  $("hostAdv").onclick = () => { hostState.adv = !hostState.adv; renderHost(); };
  if (hostState.adv) {
    $("stDown").onclick = () => { if (hostState.steps > 1) { hostState.steps--; renderHost(); } };
    $("stUp").onclick = () => { if (hostState.steps < 3) { hostState.steps++; renderHost(); } };
  }
  updateReach();
  $("hostGo").onclick = () => {
    const hn = /** @type {HTMLInputElement} */ ($("hn"));
    const hw = /** @type {HTMLInputElement} */ ($("hw"));
    const hp = /** @type {HTMLInputElement} */ ($("hp"));
    ctx.api.publishListing({
      t: hn.value || "Sunset Rooftop Dance",
      m: (hw.value || "Sat 18:30") + " · " + (hp.value || "Casa Verde"),
      vis: hostState.vis,
      steps: hostState.steps,
    });
    ctx.show("discover");
    showCoach("Your gathering is live — doors: " + (hostState.vis === "pub" ? "open to everyone" : "your web decides"));
  };
  $("hostCancel").onclick = () => { ctx.show("discover"); };
}
