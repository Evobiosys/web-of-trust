// @ts-check
// The ApiClient. Fixture mode wraps the mockup's demo data (events, offers,
// threads, activity seeding) and its simulated timers behind the SAME interface
// a later task will implement against a live agent:
//
//   createApiClient({ mode, agentUrl }) -> {
//     getState, subscribe, publishListing, requestBorrow, loanAction,
//     sendDm, addTrust, setVisibilityDial, sendSteward
//   }
//
// Screens never touch fixtures directly — only through this client + the store.

import { state, subscribe, notify } from "./store.js";

/**
 * @typedef {import("./store.js").ActivityItem} ActivityItem
 * @typedef {import("./store.js").HostedEvent} HostedEvent
 *
 * @typedef {Object} EventCard
 * @property {string} t
 * @property {string} m
 * @property {string} b
 * @property {string} bl
 * @property {string} [via]
 * @property {boolean} [hosted]
 *
 * @typedef {Object} Offer
 * @property {string} id
 * @property {string} t
 * @property {string} d
 * @property {string} owner
 * @property {string} [ownerId]
 * @property {boolean} [mine]
 * @property {string} tier
 * @property {string} state
 * @property {string} [via]
 * @property {boolean} [needsWeb]
 * @property {boolean} [extended]
 *
 * @typedef {Object} VisTier
 * @property {string} k
 * @property {string} t
 * @property {string} s
 */

/** @type {EventCard[]} */
const EVENTS_SEED = [
  { t: "Ecstatic Dance Palermo", m: "Sun 11:00 · Parque Tres de Febrero · with DJ Aluna", b: "pub", bl: "Public" },
  { t: "Biodanza — Casa Luna", m: "Tue 19:00 · Villa Crespo · facilitated by Clara", b: "pub", bl: "Public" },
  { t: "Contact Improv Jam", m: "Thu 20:30 · Espacio Cielo · linked ecosystem", b: "link", bl: "Linked · CI" },
  { t: "Cacao & Movement Hangout", m: "Sat 16:00 · Verde Café · community hangout", b: "hang", bl: "Hangout" },
];

/** @type {EventCard} */
const PRIVATE_EVENT_SEED = { t: "Moon Ceremony", m: "Fri 23:00 · location shared with your web · hosted by Maria’s circle", b: "priv", bl: "Private · your web" };

/** @type {Offer[]} */
const OFFERS_SEED = [
  { id: "speakers", t: "PA speakers (pair)", d: "Warm full-range pair, battery option — carried them to fifty dance floors.", owner: "Lucía", ownerId: "lucia", tier: "Friends", state: "available" },
  { id: "djtable", t: "DJ table + mixer", d: "Folding table, 4-channel mixer, cabling included.", owner: "Rafa", ownerId: "rafa", tier: "Friends", state: "available" },
  { id: "cacao", t: "Ceremonial cacao (1kg blocks)", d: "Your own offering to the web.", owner: "You", mine: true, tier: "Friends", state: "available" },
  { id: "venue", t: "Garden venue (up to 40)", d: "Quiet garden with a wooden deck — mornings and sunsets.", owner: "Sofía", ownerId: "sofia", tier: "Friends", via: "Maria", needsWeb: true, state: "available" },
];

/** @type {VisTier[]} */
const VIS = [
  { k: "pub", t: "Public", s: "Everyone — even without joining" },
  { k: "commons", t: "The Commons", s: "Anyone connected to us, any closeness" },
  { k: "friends", t: "Friends", s: "Friends or closer — the usual bar" },
  { k: "close", t: "Close friends", s: "The inner room" },
];

/** @type {Record<string, Record<number, string>>} */
const REACH = {
  pub: {},
  commons: { 1: "about 6", 2: "about 23", 3: "about 87" },
  friends: { 1: "about 4", 2: "about 14", 3: "about 52" },
  close: { 1: "about 2", 2: "about 6", 3: "about 19" },
};

/** @typedef {ReturnType<typeof createApiClient>} ApiClient */

/**
 * @param {{ mode?: "fixture" | "live", agentUrl?: string }} [opts]
 */
export function createApiClient(opts = {}) {
  const mode = opts.mode || "fixture";
  const agentUrl = opts.agentUrl;

  // Fresh copies per client so tests stay isolated.
  const events = EVENTS_SEED.map((e) => ({ ...e }));
  const privateEvent = { ...PRIVATE_EVENT_SEED };
  const offers = OFFERS_SEED.map((o) => ({ ...o }));
  /** @type {Record<string, Array<[string, string]>>} */
  const threads = {
    lucia: [["them", "Bringing the speakers Sunday — can you carry the stands?"], ["me", "Claro! See you at the park 🌞"]],
    maria: [["them", "So good to meet you today ✨"]],
  };

  /** @param {string} id */
  function offerById(id) {
    return offers.find((o) => o.id === id);
  }

  /** @param {ActivityItem} item */
  function pushActivity(item) {
    item.done = item.done || false;
    state.activity.unshift(item);
    notify();
  }

  function getState() {
    return { ...state, events, privateEvent, offers, threads, vis: VIS, reach: REACH };
  }

  /**
   * Host "Open the doors" — publish a gathering the host authored.
   * @param {HostedEvent} listing
   */
  function publishListing(listing) {
    state.hosted = listing;
    state.justHosted = true;
    notify();
  }

  /**
   * Ask to borrow an offer. Owns the simulated request→lent timer and pushes
   * the resulting "lent" activity item.
   * @param {string} id
   */
  function requestBorrow(id) {
    const o = offerById(id);
    if (!o) return;
    o.state = "requested";
    notify();
    setTimeout(() => {
      o.state = "lent";
      pushActivity({
        icon: "🔊", who: o.owner, anchor: "RES-4", loanId: id, phase: "lent",
        txt: o.owner + " lent you the " + o.t.toLowerCase() + ". Arrange pickup — and bring them back whole.",
        actions: [{ label: "Mark returned", kind: "coral", fn: () => loanAction(id, "returned") }],
      });
    }, 1600);
  }

  /**
   * Advance a loan through its lifecycle: requested→lent→returned→complete.
   * @param {string} loan_id
   * @param {"returned" | "complete" | "notyet"} loanState
   */
  function loanAction(loan_id, loanState) {
    const o = offerById(loan_id);
    if (loanState === "returned") {
      if (o) o.state = "returned";
      const lent = state.activity.find((a) => a.loanId === loan_id && a.phase === "lent");
      if (lent) { lent.done = true; lent.res = "Returned ✓"; }
      pushActivity({
        icon: "🌀", who: "Completion", anchor: "RES-5", loanId: loan_id, phase: "completion",
        txt: "The " + (o ? o.t.toLowerCase() : "item") + " came back to " + (o ? o.owner : "them") + ". Do you feel complete?",
        actions: [
          { label: "Complete", kind: "electric", fn: () => loanAction(loan_id, "complete") },
          { label: "Not yet — say more", kind: "ghost", fn: () => loanAction(loan_id, "notyet") },
        ],
      });
      return;
    }
    const comp = state.activity.find((a) => a.loanId === loan_id && a.phase === "completion");
    if (loanState === "complete") {
      if (o) o.state = "available";
      if (comp) { comp.done = true; comp.res = "You felt complete ✓ · " + (o ? o.owner : "they") + " felt complete ✓ — held between the two of you."; }
      notify();
    } else if (loanState === "notyet") {
      if (comp) { comp.done = true; comp.res = "Noted. What’s unresolved stays within your Close friends only — never public, never a number."; }
      notify();
    }
  }

  /**
   * Complete a trust handshake (the ceremony). Creates the Maria edge; whether
   * it opens gated content depends on the offered level.
   * @param {string} card
   * @param {string} level
   */
  function addTrust(card, level) {
    state.met = true;
    state.mariaLevel = level;
    state.unlocked = level !== "Contact";
    state.justUnlocked = state.unlocked;
    notify();
  }

  /** @param {boolean} on */
  function setVisibilityDial(on) {
    state.visibilityDial = !!on;
    notify();
  }

  /**
   * Send a direct message in a thread.
   * @param {string} peer
   * @param {string} text
   */
  function sendDm(peer, text) {
    if (!text) return;
    (threads[peer] = threads[peer] || []).push(["me", text]);
    notify();
  }

  /**
   * Steward (agent) chat — a stub wired against a real agent in a later task.
   * @param {string} text
   * @returns {Promise<null>}
   */
  function sendSteward(text) {
    void text;
    void agentUrl;
    return Promise.resolve(null);
  }

  /** Seed the onboarding activity (Rafa's RES-6 cacao extension request). */
  function seed() {
    if (state.seeded) return;
    state.seeded = true;
    pushActivity({
      icon: "🍫", who: "Rafa", anchor: "RES-6",
      txt: "wants his web to know about your <b>cacao</b>. Share the offer one ring further, through him?<br><span style='font-size:12px;color:var(--ink-soft)'>You still approve every borrower.</span>",
      actions: [
        { label: "Share it", kind: "electric", fn: (it) => { const c = offerById("cacao"); if (c) c.extended = true; it.done = true; it.res = "Shared ✓ — your cacao now reaches Rafa’s web through him. Withdraw anytime."; notify(); } },
        { label: "Keep it close", kind: "ghost", fn: (it) => { it.done = true; it.res = "Kept close. Rafa sees a gentle no."; notify(); } },
      ],
    });
  }

  return {
    mode, agentUrl,
    getState, subscribe, offerById, seed,
    publishListing, requestBorrow, loanAction,
    sendDm, addTrust, setVisibilityDial, sendSteward,
  };
}
