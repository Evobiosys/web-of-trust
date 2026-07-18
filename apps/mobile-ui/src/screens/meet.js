// @ts-check
// The ceremony (cosmic register): share composer → scan → confirm → weaving,
// then the celebration. addTrust creates the Maria edge; the level decides
// whether the Moon Ceremony opens.

import QRCode from "qrcode";
import { $ } from "../dom.js";
import { state } from "../store.js";
import { AVA_GRADS } from "../avatars.js";
import { ctx } from "../context.js";
import { reduced } from "../motion.js";
import { confetti } from "../confetti.js";
import { showCoach } from "../coach.js";
import { renderList } from "./discover.js";
import { levelLabel } from "./web.js";

/**
 * Render a real QR of the compact card JSON into `#qrsvg`, plus a copy-code
 * button beside it (the QR encodes the same JSON the paste-fallback accepts).
 * @param {any} card
 */
function renderRealCard(card) {
  const payload = JSON.stringify(card);
  const holder = document.getElementById("qrsvg");
  if (holder) {
    QRCode.toString(payload, { type: "svg", margin: 1, width: 180 })
      .then((svg) => { holder.innerHTML = svg; })
      .catch(() => { holder.textContent = "QR unavailable — share your code below."; });
  }
  const copyBtn = document.getElementById("copyCode");
  if (copyBtn) {
    copyBtn.onclick = () => {
      const nav = /** @type {any} */ (navigator);
      if (nav && nav.clipboard && nav.clipboard.writeText) void nav.clipboard.writeText(payload);
      showCoach("Code copied — paste it into their phone");
    };
  }
}

/** Best-effort camera scan via BarcodeDetector; resolves on the first QR. */
function tryBarcodeScan() {
  const B = /** @type {any} */ (window).BarcodeDetector;
  const nav = /** @type {any} */ (navigator);
  if (!B || !nav.mediaDevices || !nav.mediaDevices.getUserMedia) return;
  const video = /** @type {HTMLVideoElement | null} */ (document.getElementById("scanVideo"));
  if (!video) return;
  const detector = new B({ formats: ["qr_code"] });
  let stop = false;
  nav.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then((/** @type {MediaStream} */ stream) => {
    video.srcObject = stream;
    void video.play();
    const tick = async () => {
      if (stop || state.screen !== "meet") { stream.getTracks().forEach((t) => t.stop()); return; }
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length && ctx.api.resolveCard(codes[0].rawValue)) {
          stop = true;
          stream.getTracks().forEach((t) => t.stop());
          renderCeremony("confirm");
          return;
        }
      } catch { /* keep trying */ }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).catch(() => { /* no camera — the paste fallback carries the flow */ });
}

/**
 * Pull an honest "met at <place>" clause out of a pendingMeet's ctxLabel.
 * Fixture's ctxLabel is shaped "☀ Ecstatic Dance Palermo · today" — a real
 * place + date. Live's default (api_client_live.js resolveCard) is the
 * generic "☀ Met just now" — no place, so the met-at clause is omitted
 * rather than inventing one (I1).
 * @param {any} pm
 * @returns {string | null}
 */
function meetPlace(pm) {
  const raw = (pm && pm.ctxLabel) || "";
  const stripped = raw.replace(/^[^\w]+/, "").trim();
  const parts = stripped.split("·").map((/** @type {string} */ s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[0] : null;
}

/** @param {HTMLCanvasElement} canvas */
function fakeQR(canvas) {
  const x = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  if (!x) return;
  const n = 21, s = canvas.width / n;
  x.fillStyle = "#fff";
  x.fillRect(0, 0, canvas.width, canvas.width);
  x.fillStyle = "#241B2E";
  let seed = 7;
  function rnd() { seed = (seed * 137 + 41) % 271; return seed / 271; }
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const finder = (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    if (finder) continue;
    if (rnd() > 0.55) x.fillRect(c * s, r * s, s - 1, s - 1);
  }
  /** @param {number} r @param {number} c */
  function finderAt(r, c) {
    x.fillRect(c * s, r * s, 7 * s, 7 * s);
    x.fillStyle = "#fff"; x.fillRect((c + 1) * s, (r + 1) * s, 5 * s, 5 * s);
    x.fillStyle = "#9A37F0"; x.fillRect((c + 2) * s, (r + 2) * s, 3 * s, 3 * s);
    x.fillStyle = "#241B2E";
  }
  finderAt(0, 0); finderAt(0, n - 7); finderAt(n - 7, 0);
}

/** @param {string} step */
export function renderCeremony(step) {
  const el = $("cerInner");
  el.setAttribute("data-anchor", step === "idle" ? "CER-1" : "CER-4");
  if (step === "idle") {
    const lv = state.offerLevel;
    const myCard = ctx.api.getState().myCard;
    const qrCard = myCard
      ? '<div class="qr-card" data-anchor="CER-3"><div id="qrsvg" style="width:180px;height:180px;display:flex;align-items:center;justify-content:center">…</div></div>' +
        '<button class="btn btn-ghost btn-sm" id="copyCode" style="margin-top:6px">Copy my code</button>'
      : '<div class="qr-card" data-anchor="CER-3"><canvas id="qr" width="180" height="180"></canvas></div>';
    const chanVisual = state.chan === "qr"
      ? qrCard
      : '<div class="qr-card" data-anchor="CER-3" style="width:216px;height:216px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--violet-deep);font-weight:600;font-size:14px;text-align:center;padding:20px">' +
        "📳<br>Hold your phones together</div>";
    el.innerHTML =
      '<span class="eyebrow">Meet</span>' +
      "<h2>Add someone you just met</h2>" +
      '<div class="lvl-row" style="margin-top:12px">' +
      '<button class="lvl-pill' + (lv === "Contact" ? " on" : "") + '" data-l="Contact">Contact</button>' +
      '<button class="lvl-pill' + (lv === "Friend" ? " on" : "") + '" data-l="Friend">Friend</button>' +
      '<button class="lvl-pill' + (lv === "Close friend" ? " on" : "") + '" data-l="Close friend">Close friend</button>' +
      "</div>" +
      '<p class="sub" style="margin-top:8px">' +
      (lv === "Contact" ? "You’ll hold each other’s cards. The easy default — grow it later." :
        lv === "Friend" ? "You’ll be in each other’s web: friend gatherings, offers, second rings." :
          "The inner room: close gatherings and more intimate sharing.") + "</p>" +
      chanVisual +
      '<button class="btn btn-electric" id="scanBtn" style="margin-top:14px">Scan theirs instead</button>' +
      '<div class="chan-row">' +
      '<button class="chan' + (state.chan === "qr" ? " on" : "") + '" data-c="qr">QR</button>' +
      '<button class="chan' + (state.chan === "nfc" ? " on" : "") + '" data-c="nfc">NFC</button>' +
      '<button class="chan" disabled title="Coming later">AirDrop</button>' +
      "</div>" +
      '<button class="adv-link" id="advBtn" data-anchor="CER-2">' + (state.adv ? "Hide advanced" : "Advanced: what they may reach") + "</button>" +
      (state.adv
        ? '<div class="perm-panel" data-anchor="CER-2">' +
          '<button class="perm-row' + (state.permCtx ? "" : " off") + '" data-p="permCtx">Ecstatic-dance context only — widen later if you choose<span class="tog">' + (state.permCtx ? "On" : "Off") + "</span></button>" +
          '<button class="perm-row' + (state.permOffers ? "" : " off") + '" data-p="permOffers">May see my offers at their level<span class="tog">' + (state.permOffers ? "On" : "Off") + "</span></button>" +
          '<button class="perm-row' + (state.permRing ? "" : " off") + '" data-p="permRing">May see my second ring (people who consent)<span class="tog">' + (state.permRing ? "On" : "Off") + "</span></button>" +
          '<p style="font-size:11px;color:#A78CC9;margin:4px 2px 0">Skippable — everything here can be adjusted per person, later.</p>' +
          "</div>"
        : "") +
      '<p class="offline-note">Works with no signal. The floor doesn’t need wifi.</p>';
    if (state.chan === "qr") {
      if (myCard) renderRealCard(myCard);
      else fakeQR(/** @type {HTMLCanvasElement} */ ($("qr")));
    }
    el.querySelectorAll(".lvl-pill").forEach((pill) => {
      /** @type {HTMLElement} */ (pill).onclick = () => {
        state.offerLevel = pill.getAttribute("data-l") || "Contact";
        renderCeremony("idle");
      };
    });
    el.querySelectorAll(".chan").forEach((chEl) => {
      const ch = /** @type {HTMLButtonElement} */ (chEl);
      ch.onclick = () => {
        if (ch.disabled || !ch.getAttribute("data-c")) return;
        state.chan = ch.getAttribute("data-c") || "qr";
        renderCeremony("idle");
      };
    });
    $("advBtn").onclick = () => { state.adv = !state.adv; renderCeremony("idle"); };
    el.querySelectorAll(".perm-row").forEach((prEl) => {
      /** @type {HTMLElement} */ (prEl).onclick = () => {
        const k = prEl.getAttribute("data-p");
        if (k === "permCtx" || k === "permOffers" || k === "permRing") state[k] = !state[k];
        renderCeremony("idle");
      };
    });
    $("scanBtn").onclick = () => { renderCeremony("scan"); };
  } else if (step === "scan") {
    const live = !!ctx.api.getState().myCard;
    if (live) {
      // Real scan: BarcodeDetector when available (iOS Safari has none), and
      // ALWAYS a manual paste fallback for the compact card JSON.
      el.innerHTML =
        '<span class="eyebrow">Meet</span>' +
        "<h2>Point at their code</h2>" +
        '<div class="vf"><video id="scanVideo" playsinline muted style="width:100%;height:100%;object-fit:cover;border-radius:inherit"></video><div class="scanline"></div></div>' +
        '<p class="sub" style="margin-top:10px">No camera? Paste the code they copied:</p>' +
        '<textarea id="pasteCode" class="msg-input" rows="3" placeholder=\'{"peer_id":"…","display":"…"}\' style="width:100%;resize:vertical"></textarea>' +
        '<div class="actions">' +
        '<button class="btn btn-electric" id="useCode">Use their code</button>' +
        '<button class="btn btn-ghost" id="cancelScan">Cancel</button></div>' +
        '<p id="pasteErr" class="sub" style="color:#a3472f;display:none">That code didn’t look right — check and try again.</p>';
      $("cancelScan").onclick = () => { renderCeremony("idle"); };
      $("useCode").onclick = () => {
        const ta = /** @type {HTMLTextAreaElement} */ ($("pasteCode"));
        if (ctx.api.resolveCard(ta.value.trim())) renderCeremony("confirm");
        else { const e = $("pasteErr"); if (e) e.style.display = ""; }
      };
      tryBarcodeScan();
      return;
    }
    el.innerHTML =
      '<span class="eyebrow">Meet</span>' +
      "<h2>Point at their code</h2>" +
      '<div class="vf"><div class="scanline"></div></div>' +
      '<div class="actions"><button class="btn btn-ghost" id="cancelScan">Cancel</button></div>';
    $("cancelScan").onclick = () => { renderCeremony("idle"); };
    setTimeout(() => { if (state.screen === "meet") renderCeremony("confirm"); }, reduced ? 400 : 1700);
  } else if (step === "confirm") {
    const pm = ctx.api.getState().pendingMeet;
    el.innerHTML =
      '<span class="eyebrow">Found someone</span>' +
      '<div class="big-ava" style="background:' + (AVA_GRADS[pm.card.peer] || AVA_GRADS.maria) + '">' + pm.initial + "</div>" +
      "<h2>" + pm.display + "</h2>" +
      '<div class="ctx-chip">' + pm.ctxLabel + "</div>" +
      '<p class="sub">Is this the person in front of you?</p>' +
      '<div class="lvl-row">' +
      '<button class="lvl-pill" data-l="Contact">Contact</button>' +
      '<button class="lvl-pill" data-l="Friend">Friend</button>' +
      '<button class="lvl-pill" data-l="Close friend">Close friend</button>' +
      "</div>" +
      '<p class="sub" style="margin-top:10px;font-size:11.5px">Contact = cards only, the easy default. You can grow it later.</p>' +
      '<div class="actions">' +
      '<button class="btn btn-coral" id="confirmBtn" disabled>Yes — this is ' + pm.display + "</button>" +
      '<button class="btn btn-ghost" id="cancel2">Cancel</button>' +
      "</div>";
    const pills = el.querySelectorAll(".lvl-pill");
    /** @param {Element} pill */
    function pickLevel(pill) {
      pills.forEach((p) => p.classList.remove("on"));
      pill.classList.add("on");
      state.mariaLevel = pill.getAttribute("data-l");
      /** @type {HTMLButtonElement} */ ($("confirmBtn")).disabled = false;
    }
    pills.forEach((pill) => {
      /** @type {HTMLElement} */ (pill).onclick = () => pickLevel(pill);
      if (pill.getAttribute("data-l") === state.offerLevel) pickLevel(pill);
    });
    $("cancel2").onclick = () => { renderCeremony("idle"); };
    $("confirmBtn").onclick = () => { renderCeremony("weaving"); };
  } else if (step === "weaving") {
    const pm = ctx.api.getState().pendingMeet;
    el.innerHTML =
      '<span class="eyebrow">One moment</span>' +
      "<h2>Weaving…</h2>" +
      '<svg class="thread-line" viewBox="0 0 230 60">' +
      '<defs><linearGradient id="wv" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#4FD7A0"/><stop offset="1" stop-color="#12A8E3"/></linearGradient></defs>' +
      '<path d="M5 30 C 60 5, 90 55, 115 30 S 190 5, 225 30" fill="none" stroke="url(#wv)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="300" stroke-dashoffset="300">' +
      (reduced ? "" : '<animate attributeName="stroke-dashoffset" from="300" to="0" dur="1.1s" fill="freeze"/>') +
      "</path></svg>" +
      '<p class="sub">' + pm.display + " is confirming you on their phone.</p>";
    setTimeout(() => {
      void Promise.resolve(ctx.api.addTrust(pm.card, state.mariaLevel || "Friend"));
      const opens = state.unlocked;
      renderList();
      // The bag is the only source of truth for what actually opened: fixture
      // always carries a privateEvent (Moon Ceremony); live carries none yet
      // (I1 — never promise content that isn't really there).
      const newlyOpened = opens && !!ctx.api.getState().privateEvent;
      const place = meetPlace(pm);
      const base = opens
        ? "You and " + pm.display + " now hold each other’s thread — " + levelLabel().toLowerCase() + "s" + (place ? ", at " + place : "") + "."
        : "You and " + pm.display + " now hold each other’s cards — contacts" + (place ? ", met at " + place : "") + ".";
      const tail = newlyOpened
        ? " Their circle’s Moon Ceremony just opened to you."
        : " Deeper rooms open as you grow closer.";
      $("celebText").textContent = base + tail;
      $("seeOpened").style.display = newlyOpened ? "" : "none";
      ctx.show("celebrate");
      confetti();
      // "Now check Discover" is generically true whenever a level actually
      // unlocked. The Contact-level coach line named the Moon Ceremony by
      // name — fine in fixture (it's real there), invented in live (I1), so
      // gate the wording on the bag actually carrying gated content at all.
      const hasGatedContent = !!ctx.api.getState().privateEvent;
      showCoach(
        opens
          ? "Now check <b>Discover</b> and <b>Your Web</b>"
          : hasGatedContent
            ? "“Contact” doesn’t open the Moon Ceremony — levels have teeth"
            : "“Contact” keeps things light — grow the level anytime to open more"
      );
    }, reduced ? 500 : 2100);
  }
}

/** Wire the celebration exit buttons (once). */
export function initMeet() {
  $("seeOpened").onclick = () => { ctx.show("discover"); };
  $("backFloor").onclick = () => { ctx.show("discover"); };
}
