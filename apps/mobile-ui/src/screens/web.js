// @ts-check
// Your Web: ego-centric rings + threads (SVG), the People list, and the quiet
// introduction suggestion. Person sheets explain the path in words, never a score.

import { $ } from "../dom.js";
import { state } from "../store.js";
import { AVA_GRADS } from "../avatars.js";
import { ctx } from "../context.js";
import { openSheet, closeSheet } from "../sheet.js";
import { openThread } from "./chat.js";

const NS = "http://www.w3.org/2000/svg";

export function levelLabel() {
  return state.mariaLevel || "Friend";
}

/** @param {number} cx @param {number} cy @param {number} r @param {number} deg */
function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

export function renderRings() {
  const wrap = $("rings");
  wrap.innerHTML = "";
  const C = 176, R1 = 78, R2 = 142;
  const rings = ctx.api.getState().rings;
  /** @type {any[]} */
  const ring1 = rings.ring1;
  /** @type {any[]} */
  const ring2 = rings.ring2;
  $("webCount").textContent = ring1.length + " connected · " + ring2.length + " beyond";

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 352 352");
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML =
    '<linearGradient id="th" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#4FD7A0"/><stop offset="1" stop-color="#12A8E3"/></linearGradient>';
  svg.appendChild(defs);
  [R1, R2].forEach((r) => {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", String(C)); c.setAttribute("cy", String(C)); c.setAttribute("r", String(r));
    c.setAttribute("fill", "none"); c.setAttribute("stroke", "rgba(154,55,240,.20)");
    c.setAttribute("stroke-width", "1.4"); c.setAttribute("stroke-dasharray", "3 6");
    svg.appendChild(c);
  });
  /** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
  function thread(x1, y1, x2, y2) {
    const p = document.createElementNS(NS, "path");
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 + (x1 - x2) * 0.12;
    p.setAttribute("d", "M" + x1 + " " + y1 + " Q" + mx + " " + my + " " + x2 + " " + y2);
    p.setAttribute("fill", "none"); p.setAttribute("stroke", "url(#th)");
    p.setAttribute("stroke-width", "1.8"); p.setAttribute("opacity", "0.75");
    svg.appendChild(p);
  }
  /** @type {Record<string, number[]>} */
  const pos = {};
  ring1.forEach((n) => { pos[n.id] = polar(C, C, R1, n.deg); thread(C, C, pos[n.id][0], pos[n.id][1]); });
  ring2.forEach((n, idx) => {
    const key = n.id || "g" + idx;
    n.key = key;
    pos[key] = polar(C, C, R2, n.deg);
    const viaId = n.viaId;
    if (viaId && pos[viaId]) thread(pos[viaId][0], pos[viaId][1], pos[key][0], pos[key][1]);
  });
  wrap.appendChild(svg);

  /** @param {any} n @param {number} ringIdx */
  function addNode(n, ringIdx) {
    const b = document.createElement("button");
    b.className = "node";
    const p = pos[n.key || n.id];
    b.style.left = p[0] + "px"; b.style.top = p[1] + "px";
    if (n.anon) {
      b.setAttribute("data-anchor", "RES-7");
      b.innerHTML = '<div class="ava ghost">◉</div><span>Someone</span><em class="lvl">offers ' + n.offer + " · via " + n.via + "</em>";
      b.onclick = () => {
        openSheet(
          '<div class="grab"></div><div data-anchor="RES-7"><h3>Someone, via ' + n.via + "</h3>" +
            '<div class="meta">They offer <b>' + n.offer + "</b> to " + n.via + "’s web — without sharing their name or how to reach them.</div>" +
            '<div class="path">Want it? ' + n.via + " can connect you — introductions happen only with both sides’ yes.</div>" +
            '<button class="btn btn-electric">Ask ' + n.via + " to connect you</button></div>"
        );
      };
    } else {
      if (n.asym) b.setAttribute("data-anchor", "WEB-4");
      else if (n.offer) b.setAttribute("data-anchor", "WEB-5");
      b.innerHTML =
        '<div class="ava" style="background:' + AVA_GRADS[n.id] + '">' + n.n.charAt(0) +
        (n.offer ? '<span class="offdot" title="offers something"></span>' : "") + "</div>" +
        "<span>" + n.n + "</span>" +
        (n.lvl ? '<em class="lvl">' + n.lvl + "</em>" : n.via ? '<em class="lvl">via ' + n.via + "</em>" : "") +
        (n.offer ? '<em class="lvl" style="color:#137a54">offers ' + n.offer + "</em>" : "") +
        (n.asym ? '<em class="lvl asym" style="color:#a3472f">⚠ sees you: no</em>' : "");
      b.onclick = () => { personSheet(n, ringIdx); };
    }
    wrap.appendChild(b);
  }
  ring1.forEach((n) => addNode(n, 1));
  ring2.forEach((n) => addNode(n, 2));

  const you = document.createElement("button");
  you.className = "node you";
  you.style.left = C + "px"; you.style.top = C + "px";
  you.innerHTML =
    '<div class="ava" style="background:linear-gradient(135deg,#9A37F0,#12A8E3)">' +
    state.name.charAt(0).toUpperCase() + "</div><span>" + state.name + "</span>";
  wrap.appendChild(you);
  renderIntros();
}

export function renderIntros() {
  const w = $("intWrap");
  /** @type {any[]} */
  const suggestions = ctx.api.getState().introSuggestions || [];
  // Fixture mode carries the designer's Rafa/Lucía suggestion; live carries
  // none yet (real suggestions are a future feature) — nothing invented here.
  if (state.introDone === "dismissed" || state.guest || !suggestions.length) {
    w.innerHTML = "";
    return;
  }
  const s = suggestions[0];
  w.innerHTML =
    '<div class="int-head">Threads that could meet</div>' +
    '<div class="int-card" data-anchor="INT-1">' +
    (state.introDone === "done"
      ? "<b>Introduced ✓</b> " + s.aName + " and " + s.bName + " each hold the other’s card now. The rest is theirs."
      : "<b>" + s.aName + "</b> " + s.aNeed + " <b>" + s.bName + "</b> " + s.bHave + " — they don’t know each other, but they both know you." +
        '<div class="act-btns">' +
        '<button class="btn btn-sm btn-electric" id="introGo">Introduce them</button>' +
        '<button class="btn btn-sm btn-ghost" id="introNo">Let it be</button>' +
        "</div>") +
    "</div>";
  const g = document.getElementById("introGo");
  if (g) g.onclick = () => {
    openSheet(
      '<div class="grab"></div><div data-anchor="INT-2"><h3>Introduce ' + s.aName + " and " + s.bName + "</h3>" +
        '<div class="meta">You’d share each of their cards with the other — nothing more. They each choose whether to meet. Neither is connected to the other until they do their own twenty seconds, face to face.</div>' +
        '<button class="btn btn-coral" id="introConfirm">Share both cards</button>' +
        '<button class="btn btn-ghost" id="introCancel">Cancel</button></div>'
    );
    const confirm = document.getElementById("introConfirm");
    if (confirm) confirm.onclick = () => { state.introDone = "done"; closeSheet(); renderIntros(); };
    const cancel = document.getElementById("introCancel");
    if (cancel) cancel.onclick = closeSheet;
  };
  const n = document.getElementById("introNo");
  if (n) n.onclick = () => { state.introDone = "dismissed"; renderIntros(); };
}

/** @param {any} n @param {number} ring */
function personSheet(n, ring) {
  let html = '<div class="grab"></div><div data-anchor="WEB-2"><h3>' + n.n + "</h3></div>";
  if (ring === 1) {
    const ctxLine = n.ctx || "Ecstatic Dance Palermo · June";
    html +=
      '<div class="meta">' + (n.lvl || levelLabel()) + " · met at " + ctxLine + "</div>" +
      '<div class="path">You ⟷ <b>' + n.n + '</b><br><span style="color:var(--ink-soft)">Connected in person, confirmed both ways — you hold each other’s thread.</span></div>' +
      (n.offer ? '<div class="path" style="border-left-color:var(--mint)"><b>◉ Offers ' + n.offer + "</b> — see it under Discover → Offers.</div>" : "") +
      '<div class="tagchips" data-anchor="PLC-2"><span class="tagchip">#ecstatic</span><span class="tagchip">#dj</span><span class="tagchip">#facilitator</span><span class="tagchip">＋ tag</span></div>' +
      '<button class="btn btn-electric" id="sheetMsg" data-mid="' + n.id + '" data-mn="' + n.n + '">Message</button>' +
      '<button class="btn btn-ghost">Open their card</button>' +
      '<button class="btn btn-ghost">Vouch for something they do</button>' +
      '<button class="plc-btn" data-anchor="PLC-1" data-plc="flag">⚑ Raise a flag — held for a future circle</button>';
  } else {
    const via = n.via;
    html +=
      '<div class="meta">In your second ring — you haven’t met yet.</div>' +
      '<div class="path">You ⟷ <b>' + via + "</b> ⟷ <b>" + n.n + '</b><br><span style="color:var(--ink-soft)">' + via + " knows them in person. Meet them to add your own connection.</span></div>" +
      (n.asym
        ? '<div class="path" style="border-left-color:#E0906F"><b style="color:#a3472f">⚠ Sees you: no.</b><br>' +
          '<span style="color:var(--ink-soft)">' + n.n + " turned their dial off for this path, so they can’t see you here. " +
          "Visibility is mutual by default — when it isn’t, it’s always shown, never silent.</span></div>"
        : "") +
      '<button class="btn btn-ghost">Ask ' + via + " to introduce you</button>" +
      '<p style="font-size:12px;color:var(--ink-soft);margin-top:8px">Direct messages open after an introduction — consent first.</p>';
  }
  openSheet(html);
  const sm = document.getElementById("sheetMsg");
  if (sm) sm.onclick = () => { openThread(n.id, n.n); };
}

export function renderPeople() {
  const w = $("pplList");
  w.innerHTML = "";
  /** @type {any[]} */
  const ppl = ctx.api.getState().people;
  $("pplCap").textContent = ppl.length + " people, all met in person. Tap anyone for their card.";
  ppl.forEach((p) => {
    const b = document.createElement("button");
    b.className = "prow";
    b.innerHTML =
      '<div class="ava" style="background:' + AVA_GRADS[p.id] + '">' + p.n.charAt(0) + "</div>" +
      '<div class="who"><b>' + p.n + "</b><i>" + p.c + "</i></div>" +
      '<span class="shield ' + p.s + '">' + p.sl + "</span>";
    b.onclick = () => {
      openSheet(
        '<div class="grab"></div><div data-anchor="PPL-2"><h3>' + p.n + "</h3>" +
          '<div class="meta">' + p.c + "</div>" +
          '<div class="path"><b>Their card</b><br><span style="color:var(--ink-soft)">What ' + p.n + " chooses to share with you: how to reach them, where they dance, what they offer. Updates itself when they change it.</span></div>" +
          '<div class="tagchips" data-anchor="PLC-2"><span class="tagchip">#ecstatic</span><span class="tagchip">＋ tag</span></div>' +
          '<button class="btn btn-electric" id="sheetMsg" data-mid="' + p.id + '" data-mn="' + p.n + '">Message</button>' +
          '<button class="btn btn-ghost">Grow this connection</button>' +
          (p.s === "out" ? '<button class="btn btn-ghost">Waiting for ' + p.n + " to confirm</button>" : "") +
          '<button class="plc-btn" data-anchor="PLC-1" data-plc="flag">⚑ Raise a flag — held for a future circle</button></div>'
      );
      const sm = document.getElementById("sheetMsg");
      if (sm) sm.onclick = () => { openThread(p.id, p.n); };
    };
    w.appendChild(b);
  });
}
