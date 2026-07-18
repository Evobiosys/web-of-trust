// @ts-check
// Chat screen: thread list + the "Waiting on you" activity feed, plus the
// shared bell badge and the thread sheet (opened from Web/People too).

import { $ } from "../dom.js";
import { AVA_GRADS } from "../avatars.js";
import { ctx } from "../context.js";
import { openSheet } from "../sheet.js";

/** Update every bell badge from the count of activity items awaiting me. */
export function updateBell() {
  const s = ctx.api.getState();
  const n = s.activity.filter((a) => !a.done).length;
  const bdgs = document.querySelectorAll("[data-bdg]");
  bdgs.forEach((b) => {
    b.textContent = String(n);
    b.classList.toggle("zero", n === 0);
  });
}

export function renderActivity() {
  const w = $("actList");
  w.innerHTML = "";
  const s = ctx.api.getState();
  if (!s.activity.length) {
    w.innerHTML = '<p class="map-cap" style="padding:20px 8px">Nothing waiting on you. The bell only rings when someone needs <i>you</i> — no streaks, no noise.</p>';
    return;
  }
  s.activity.forEach((item) => {
    const d = document.createElement("div");
    d.className = "act-row" + (item.done ? " done" : "");
    if (item.anchor) d.setAttribute("data-anchor", item.anchor);
    d.innerHTML =
      '<div class="who-line">' + (item.icon || "·") + " " + item.who + "</div>" + item.txt +
      (item.res ? '<div class="act-res">' + item.res + "</div>" : "");
    if (!item.done && item.actions) {
      const btns = document.createElement("div");
      btns.className = "act-btns";
      item.actions.forEach((a) => {
        const b = document.createElement("button");
        b.className = "btn btn-sm btn-" + (a.kind || "electric");
        b.textContent = a.label;
        b.onclick = () => { a.fn(item); };
        btns.appendChild(b);
      });
      d.appendChild(btns);
    }
    w.appendChild(d);
  });
  updateBell();
}

export function renderChat() {
  const w = $("threadList");
  w.innerHTML = "";
  const s = ctx.api.getState();
  /** @type {any[]} */
  const rows = s.threadList;
  rows.forEach((t) => {
    const b = document.createElement("button");
    b.className = "prow";
    b.innerHTML =
      '<div class="ava" style="background:' + AVA_GRADS[t.id] + '">' + t.n.charAt(0) + "</div>" +
      '<div class="who"><b>' + t.n + "</b><i>" + t.last + "</i></div>";
    b.onclick = () => { openThread(t.id, t.n); };
    w.appendChild(b);
  });
  renderActivity();
}

/**
 * Open a direct-message thread sheet. sendDm wires the composer minimally.
 * @param {string} id
 * @param {string} name
 */
export function openThread(id, name) {
  const s = ctx.api.getState();
  const bubs = (s.threads[id] || [])
    .map((m) => '<div class="bub ' + m[0] + '">' + m[1] + "</div>")
    .join("");
  openSheet(
    '<div class="grab"></div><h3>' + name + "</h3>" +
      '<div class="meta">End-to-end between the two of you — carried by your own thread.</div>' +
      '<div class="thread-bubs" id="threadBubs">' + bubs + "</div>" +
      '<input class="msg-input" id="dmInput" placeholder="Message ' + name + '…" aria-label="Message ' + name + '">'
  );
  const input = /** @type {HTMLInputElement} */ ($("dmInput"));
  input.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const text = input.value.trim();
    if (!text) return;
    ctx.api.sendDm(id, text);
    input.value = "";
    const bubsEl = $("threadBubs");
    const b = document.createElement("div");
    b.className = "bub me";
    b.textContent = text;
    bubsEl.appendChild(b);
  };
}
