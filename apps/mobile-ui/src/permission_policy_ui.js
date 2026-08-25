// @ts-check
// Permission-gating UI: the split share button (broad default + three
// user-configurable secondary options, promotable) and the audience x
// category matrix, per the approved reference design
// (evobiosys.org/web-of-trust/draft-prototype/index.html, section 1) —
// D21/gating-ui.
//
// State machine: imported directly from agent-daemon's canonical module
// rather than re-implemented here. That's safe in a browser bundle because
// packages/agent-daemon/src/policy/permission_policy.ts has ZERO runtime
// imports (verified: `dist/policy/permission_policy.js` has no `import`
// statements at all) — nothing better-sqlite3/ws-shaped comes along for the
// ride, unlike importing the package's own dist/index.js barrel would.
//
// Persistence: LOCAL-FIRST FOR NOW (task report / FUTURE.md follow-up). The
// daemon's Store now has a real PermissionPolicyRecord table
// (sqlite_store.ts, D21), but no `/api/policy` REST route exists yet and
// api_client_live.js has no client method for one — wiring the live round
// trip needs both of those plus a server.ts handler, deliberately left out
// of this branch (see task report: "what's stubbed"). This module persists
// to localStorage instead, under the SAME `{ policy, cross_community }`
// shape a future PUT /api/policy body would use, so swapping
// `loadRecord`/`saveRecord` below for a `req("/api/policy", ...)` call is a
// one-file change. Mirrors the localStorage-first pattern connect_flow.js
// and guest_chat.js already use for other browser-only state in this app,
// including their try/catch degrade-to-memory guard (Safari private mode /
// this repo's Node test runner).
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  RING_LABEL,
  RING_ORDER,
  createDefaultPolicy,
  cycleCrossCommunityRule,
  cycleShareCell,
  getCrossCommunityRule,
  promoteToDefault,
} from "@resource-web/agent-daemon/dist/policy/permission_policy.js";

/**
 * @typedef {import("@resource-web/agent-daemon/dist/policy/permission_policy.js").PermissionPolicy} PermissionPolicy
 * @typedef {import("@resource-web/agent-daemon/dist/policy/permission_policy.js").CrossCommunityRules} CrossCommunityRules
 * @typedef {import("@resource-web/agent-daemon/dist/policy/permission_policy.js").AudienceRing} AudienceRing
 * @typedef {import("@resource-web/agent-daemon/dist/policy/permission_policy.js").PolicyCategoryId} PolicyCategoryId
 * @typedef {{ policy: PermissionPolicy, cross_community: CrossCommunityRules, updated_at: string }} PolicyRecord
 */

const LS_KEY = "resource-web.permission_policy";

/** Seed used the first time a persona has no policy yet — matches host.js's
 * pre-existing `hostState.vis` default ("friends"): "trusted" audience seeds
 * exactly that ring (see permission_policy.ts's SEED_RING). Not read from a
 * live AppProfile.defaultPolicy today (mobile-ui doesn't carry the active
 * persona's daemon-side profile id into this module) — a reasonable I9
 * conservative default on its own, and a documented TODO to thread the real
 * profile through once `getProfile()`'s id is plumbed to a daemon call. */
const FALLBACK_SEED = /** @type {const} */ ({ audience: "trusted", mode: "ask_each_time" });

/** @type {Map<string, string> | undefined} */
let memoryFallback;
/** @returns {Map<string, string>} */
function fallbackStore() {
  if (!memoryFallback) memoryFallback = new Map();
  return memoryFallback;
}
function readStore() {
  try {
    return window.localStorage.getItem(LS_KEY) ?? undefined;
  } catch {
    return fallbackStore().get(LS_KEY);
  }
}
/** @param {string} value */
function writeStore(value) {
  try {
    window.localStorage.setItem(LS_KEY, value);
  } catch {
    fallbackStore().set(LS_KEY, value);
  }
}

/** Test-only: drop the persisted policy from both real storage (if present)
 * and the in-memory fallback, mirroring connect_flow.js's equivalent — also
 * clears `cached` below, unlike that one, since this module memoizes the
 * loaded record for the process lifetime. */
export function __clearPolicyStorageForTests() {
  try { window.localStorage.removeItem(LS_KEY); } catch { /* fall through */ }
  fallbackStore().delete(LS_KEY);
  cached = undefined;
}

/** @returns {PolicyRecord} */
function loadRecord() {
  const raw = readStore();
  if (raw) {
    try {
      return /** @type {PolicyRecord} */ (JSON.parse(raw));
    } catch {
      // fall through to a fresh default below — corrupt/old-shape localStorage
      // must never crash the composer.
    }
  }
  return { policy: createDefaultPolicy(FALLBACK_SEED), cross_community: {}, updated_at: new Date().toISOString() };
}

/** @param {PolicyRecord} record */
function saveRecord(record) {
  writeStore(JSON.stringify(record));
}

/** @type {PolicyRecord | undefined} */
let cached;

/** @returns {PolicyRecord} */
export function getPolicyRecord() {
  if (!cached) cached = loadRecord();
  return cached;
}

/** @param {PolicyRecord} next */
function commit(next) {
  cached = next;
  saveRecord(next);
}

/** @param {PolicyCategoryId} category @param {AudienceRing} ring */
export function cycleShareCellAndSave(category, ring) {
  const record = getPolicyRecord();
  commit({ ...record, policy: cycleShareCell(record.policy, category, ring), updated_at: new Date().toISOString() });
}

/** @param {PolicyCategoryId} category @param {0 | 1 | 2} slotIndex */
export function promoteToDefaultAndSave(category, slotIndex) {
  const record = getPolicyRecord();
  commit({ ...record, policy: promoteToDefault(record.policy, category, slotIndex), updated_at: new Date().toISOString() });
}

/** @param {PolicyCategoryId} category @param {string} communityId */
export function cycleCrossCommunityRuleAndSave(category, communityId) {
  const record = getPolicyRecord();
  commit({
    ...record,
    cross_community: cycleCrossCommunityRule(record.cross_community, category, communityId),
    updated_at: new Date().toISOString(),
  });
}

// -------------------------------------------------------------- rendering --

/**
 * The split share button + dropdown for one category, matching the
 * reference design's `#sharebar`/`#shareDrop` markup 1:1 in structure (ids
 * are fixed, not namespaced by category, per this app's existing pattern of
 * one mounted instance at a time — see host.js's `hostGo`/`hostCancel`).
 * @param {PolicyCategoryId} category
 */
export function shareBarHtml(category) {
  const cat = getPolicyRecord().policy[category];
  return (
    '<div class="sharebar" id="sharebar">' +
    '<button class="share-main" id="shareMain">Share &middot; <span id="shareLabel">' + RING_LABEL[cat.primaryRing] + "</span></button>" +
    '<button class="share-caret" id="shareCaret" aria-label="More sharing options">&#9662;</button>' +
    '<div class="share-drop" id="shareDrop">' +
    '<div id="optSlots"></div>' +
    '<div class="divider"></div>' +
    '<button class="more" id="matrixToggle">All options — full matrix &#9656;</button>' +
    "</div>" +
    "</div>" +
    '<div class="perm-matrix" id="permMatrix">' +
    "<table><thead><tr><th></th>" +
    RING_ORDER.map((r) => "<th>" + RING_LABEL[r] + "</th>").join("") +
    "</tr></thead><tbody id=\"permMatrixBody\"></tbody></table>" +
    '<p class="hint" style="font-size:11.5px;color:var(--ink-soft);margin-top:6px">Tap a cell to cycle: <b>share</b> &rarr; <b>ask</b> &rarr; <b>once</b> &rarr; off. These become your standing defaults for ' +
    CATEGORY_LABEL[category].toLowerCase() +
    ".</p>" +
    "</div>" +
    '<p class="perm-status" id="shareStatus"></p>'
  );
}

/**
 * Wires the split button + matrix rendered by `shareBarHtml` for one
 * category. Calls `onRingChange(ring)` whenever the effective "use this ring
 * for the thing I'm composing right now" selection changes — pressing the
 * main button, tapping a secondary option's body, or promoting a secondary
 * to default. Matrix-cell taps set STANDING defaults only and intentionally
 * do NOT call `onRingChange` (see permission_policy.ts's module doc comment
 * — the split button and the matrix are two separate state machines).
 * @param {PolicyCategoryId} category
 * @param {(ring: AudienceRing) => void} onRingChange
 */
export function wireShareBar(category, onRingChange) {
  const drop = /** @type {HTMLElement} */ (document.getElementById("shareDrop"));
  const caret = /** @type {HTMLElement} */ (document.getElementById("shareCaret"));
  const main = /** @type {HTMLElement} */ (document.getElementById("shareMain"));
  const label = /** @type {HTMLElement} */ (document.getElementById("shareLabel"));
  const status = /** @type {HTMLElement} */ (document.getElementById("shareStatus"));
  const slotBox = /** @type {HTMLElement} */ (document.getElementById("optSlots"));
  const matrixToggle = /** @type {HTMLElement} */ (document.getElementById("matrixToggle"));
  const matrix = /** @type {HTMLElement} */ (document.getElementById("permMatrix"));
  const matrixBody = /** @type {HTMLElement} */ (document.getElementById("permMatrixBody"));

  function renderSlots() {
    const cat = getPolicyRecord().policy[category];
    label.textContent = RING_LABEL[cat.primaryRing];
    slotBox.innerHTML = "";
    cat.secondaryRings.forEach((ring, i) => {
      const b = document.createElement("button");
      b.className = "opt";
      b.innerHTML = "<span>" + RING_LABEL[ring] + "</span><span class='set'>set as default</span>";
      b.addEventListener("click", (ev) => {
        const target = /** @type {HTMLElement} */ (ev.target);
        if (target.classList.contains("set")) {
          promoteToDefaultAndSave(category, /** @type {0 | 1 | 2} */ (i));
          renderSlots();
          onRingChange(getPolicyRecord().policy[category].primaryRing);
          status.innerHTML = "Default changed to <b>" + RING_LABEL[getPolicyRecord().policy[category].primaryRing] + "</b>.";
        } else {
          onRingChange(ring);
          status.innerHTML = "Shared with <b>" + RING_LABEL[ring] + "</b> (one action, no default change).";
        }
        drop.classList.remove("open");
      });
      slotBox.appendChild(b);
    });
  }

  function renderMatrix() {
    matrixBody.innerHTML = "";
    CATEGORY_ORDER.forEach((cat) => {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td class='rowhead'>" + CATEGORY_LABEL[cat] + "</td>";
      RING_ORDER.forEach((ring) => {
        const td = document.createElement("td");
        const b = document.createElement("button");
        const state = getPolicyRecord().policy[cat].matrix[ring];
        b.className = state === "off" ? "" : state;
        b.textContent = state === "off" ? "—" : state;
        b.addEventListener("click", () => {
          cycleShareCellAndSave(cat, ring);
          renderMatrix();
          if (cat === category) renderSlots();
        });
        td.appendChild(b);
        tr.appendChild(td);
      });
      matrixBody.appendChild(tr);
    });
  }

  renderSlots();
  renderMatrix();
  caret.addEventListener("click", () => drop.classList.toggle("open"));
  main.addEventListener("click", () => {
    const ring = getPolicyRecord().policy[category].primaryRing;
    onRingChange(ring);
    status.innerHTML = "Shared with <b>" + RING_LABEL[ring] + "</b> — the broad default, one tap.";
  });
  matrixToggle.addEventListener("click", () => matrix.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    const bar = document.getElementById("sharebar");
    if (bar && !bar.contains(/** @type {Node} */ (e.target))) drop.classList.remove("open");
  });
}
