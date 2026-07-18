// @ts-check
// Discover screen: Gatherings (list/map) and Offers, plus the request sheet.

import { $ } from "../dom.js";
import { state } from "../store.js";
import { AVA_GRADS } from "../avatars.js";
import { ctx } from "../context.js";
import { openSheet, closeSheet } from "../sheet.js";
import { showCoach } from "../coach.js";

export function renderList() {
  const w = $("listWrap");
  w.innerHTML = "";
  const s = ctx.api.getState();
  if (s.guest) {
    const pitch = document.createElement("div");
    pitch.className = "card private";
    pitch.setAttribute("data-anchor", "DIS-5");
    pitch.innerHTML =
      "<h3>This is the public floor</h3>" +
      "<div class='meta'>Join the web of trust and more appears — private gatherings your friends open to you, " +
      "things to borrow from your people, and the people they hold. Built on real, in-person meetings.</div>";
    w.appendChild(pitch);
  }
  const list = s.events.slice();
  if (s.unlocked && s.privateEvent) list.splice(2, 0, s.privateEvent);
  if (s.hosted) {
    const h = s.hosted;
    const pub = h.vis === "pub";
    const visT = s.vis.filter((x) => x.k === h.vis)[0].t;
    list.unshift({
      t: h.t, m: h.m + " · you host this", b: pub ? "pub" : "priv",
      bl: pub ? "Public · yours" : "Private · yours",
      via: pub ? undefined : "☾ Doors: " + visT.toLowerCase() + ", within " + h.steps + " step" + (h.steps > 1 ? "s" : ""),
      hosted: true,
    });
  }
  list.forEach((ev) => {
    const d = document.createElement("div");
    d.className = "card" + (ev.b === "priv" ? " private" : "");
    d.setAttribute("data-anchor", ev.b === "priv" ? "DIS-3" : "DIS-2");
    d.innerHTML =
      "<h3>" + ev.t + "</h3><div class='meta'>" + ev.m + "</div>" +
      "<span class='badge " + ev.b + "'>" + ev.bl + "</span>" +
      (ev.via
        ? "<div class='via'>" + ev.via + "</div>"
        : ev.b === "priv" && !ev.hosted
          ? "<div class='via'>☾ Opened by your web — via Maria</div>"
          : "");
    if ((ev.b === "priv" && state.justUnlocked && !ev.hosted) || (ev.hosted && state.justHosted)) d.classList.add("reveal");
    w.appendChild(d);
  });
  state.justUnlocked = false;
  state.justHosted = false;
}

/** @param {boolean} isList */
function seg(isList) {
  $("segList").classList.toggle("on", isList);
  $("segMap").classList.toggle("on", !isList);
  $("listWrap").classList.toggle("off", !isList);
  $("mapWrap").classList.toggle("on", !isList);
  $("listCap").textContent = isList
    ? "Public events in your city. What your web opens, appears here too — quietly."
    : "The city at night. Each light is a gathering; threads are your people between them.";
  if (!isList) drawMap();
}

function drawMap() {
  const c = /** @type {HTMLCanvasElement} */ ($("mapCanvas"));
  const x = c.getContext("2d");
  if (!x) return;
  x.clearRect(0, 0, 356, 300);
  const g = x.createLinearGradient(0, 0, 356, 300);
  g.addColorStop(0, "#221038");
  g.addColorStop(1, "#0E2A40");
  x.fillStyle = g;
  x.fillRect(0, 0, 356, 300);
  x.strokeStyle = "rgba(237,230,242,.07)";
  x.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    x.beginPath(); x.moveTo(i * 60 - 30, 0); x.lineTo(i * 60 + 30, 300); x.stroke();
    x.beginPath(); x.moveTo(0, i * 50 - 20); x.lineTo(356, i * 50 + 20); x.stroke();
  }
  const pts = [[90, 80], [240, 70], [170, 160], [70, 220], [280, 210]];
  if (state.unlocked) pts.push([225, 145]);
  x.lineWidth = 1.4;
  for (let j = 0; j < pts.length - 1; j++) {
    const lg = x.createLinearGradient(pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]);
    lg.addColorStop(0, "rgba(79,215,160,.5)");
    lg.addColorStop(1, "rgba(18,168,227,.5)");
    x.strokeStyle = lg;
    x.beginPath();
    x.moveTo(pts[j][0], pts[j][1]);
    x.quadraticCurveTo((pts[j][0] + pts[j + 1][0]) / 2 + 18, (pts[j][1] + pts[j + 1][1]) / 2 - 18, pts[j + 1][0], pts[j + 1][1]);
    x.stroke();
  }
  for (let k = 0; k < pts.length; k++) {
    const isPriv = state.unlocked && k === pts.length - 1;
    const col = isPriv ? "#4FD7A0" : "#12A8E3";
    const rg = x.createRadialGradient(pts[k][0], pts[k][1], 1, pts[k][0], pts[k][1], 16);
    rg.addColorStop(0, col);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = rg;
    x.beginPath(); x.arc(pts[k][0], pts[k][1], 16, 0, 7); x.fill();
    x.fillStyle = "#fff";
    x.beginPath(); x.arc(pts[k][0], pts[k][1], 3.2, 0, 7); x.fill();
  }
}

export function renderOffers() {
  const w = $("offersList");
  w.innerHTML = "";
  const s = ctx.api.getState();
  s.offers.forEach((o) => {
    if (o.needsWeb && !s.unlocked) return;
    const d = document.createElement("div");
    d.className = "card";
    d.setAttribute("data-anchor", "RES-1");
    const stateChip =
      o.state === "requested" ? '<span class="res-chip loan">Requested</span>' :
      o.state === "lent" ? '<span class="res-chip loan">' + (o.mine ? "On loan" : "Borrowed by you") + "</span>" :
      o.extended ? '<span class="res-chip">Also offered via Rafa</span>' : "";
    d.innerHTML =
      "<h3>" + o.t + "</h3><div class='meta'>" + o.d + "</div>" +
      '<div class="offer-owner"><span class="ava" style="background:' +
      (o.mine ? "linear-gradient(135deg,#9A37F0,#12A8E3)" : AVA_GRADS[o.ownerId || ""]) + '">' +
      (o.mine ? s.name.charAt(0).toUpperCase() : o.owner.charAt(0)) + "</span>" +
      (o.mine ? "Yours" : o.owner + (o.via ? " · via " + o.via : "")) + "</div>" +
      '<span class="badge pub" style="margin-right:6px">' + o.tier + "</span>" + stateChip;
    d.onclick = () => { offerSheet(o); };
    w.appendChild(d);
  });
}

/** @param {import("../api_client.js").Offer} o */
function offerSheet(o) {
  if (o.mine) {
    openSheet(
      '<div class="grab"></div><div data-anchor="RES-3"><h3>' + o.t + "</h3>" +
        '<div class="meta">Offered to: <b>' + o.tier + "</b> · state: <b>" + (o.state === "available" ? "Available" : o.state) + "</b>" +
        (o.extended ? " · also reaches Rafa’s web (you can withdraw that anytime)" : "") + "</div>" +
        '<div class="path">You decide who can even see this — same doors as gatherings. Requests arrive in Activity; nothing is public.</div></div>'
    );
    return;
  }
  const canReq = o.state === "available";
  openSheet(
    '<div class="grab"></div><div data-anchor="RES-2"><h3>' + o.t + "</h3>" +
      '<div class="meta">' + o.owner + (o.via ? " · via " + o.via : "") + " · offered to " + o.tier + "</div>" +
      '<div class="path">' + o.d + "</div>" +
      (canReq
        ? '<button class="btn btn-coral" id="reqBtn">Ask to borrow</button>'
        : '<div class="act-res">' + (o.state === "requested" ? "Requested — waiting for " + o.owner : "Borrowed by you — mark it returned in Activity") + "</div>") +
      "</div>"
  );
  const rb = document.getElementById("reqBtn");
  if (rb) rb.onclick = () => {
    ctx.api.requestBorrow(o.id);
    closeSheet();
    showCoach("Request sent to <b>" + o.owner + "</b> — watch the bell");
    renderOffers();
  };
}

/** Render whichever discover segment is active (list + offers content). */
export function renderDiscover() {
  renderList();
  renderOffers();
}

/** Wire the discover segments and the host FAB (once). */
export function initDiscover() {
  $("segList").onclick = () => seg(true);
  $("segMap").onclick = () => seg(false);
  $("segGath").onclick = () => {
    $("segGath").classList.add("on");
    $("segOff").classList.remove("on");
    $("gathWrap").style.display = "";
    $("offersWrap").style.display = "none";
  };
  $("segOff").onclick = () => {
    if (state.guest) {
      openSheet('<div class="grab"></div><h3>Offers live inside the web</h3><div class="meta">Speakers, DJ tables, cacao, venues — shared between people who have actually met. Join to see what your people offer.</div>');
      return;
    }
    $("segOff").classList.add("on");
    $("segGath").classList.remove("on");
    $("gathWrap").style.display = "none";
    $("offersWrap").style.display = "";
    renderOffers();
  };
  $("hostFab").onclick = () => {
    if (state.guest) {
      openSheet(
        '<div class="grab"></div><h3>Hosting needs a web</h3>' +
          '<div class="meta">Join first — then you can host gatherings and decide exactly who can see them: ' +
          "everyone, the commons, friends, or close friends only.</div>"
      );
      return;
    }
    ctx.show("host");
  };
}
