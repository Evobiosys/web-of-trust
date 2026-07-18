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
import { createLiveClient } from "./api_client_live.js";

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

// Tier definitions + reach estimates are presentational catalog data, shared
// verbatim by both fixture and live clients (the live client imports them).
/** @type {VisTier[]} */
export const VIS = [
  { k: "pub", t: "Public", s: "Everyone — even without joining" },
  { k: "commons", t: "The Commons", s: "Anyone connected to us, any closeness" },
  { k: "friends", t: "Friends", s: "Friends or closer — the usual bar" },
  { k: "close", t: "Close friends", s: "The inner room" },
];

/** @type {Record<string, Record<number, string>>} */
export const REACH = {
  pub: {},
  commons: { 1: "about 6", 2: "about 23", 3: "about 87" },
  friends: { 1: "about 4", 2: "about 14", 3: "about 52" },
  close: { 1: "about 2", 2: "about 6", 3: "about 19" },
};

// -- Person / roster data (formerly inlined in web.js / host.js / meet.js). --
// Screens render person data purely from getState(); the live client produces
// the SAME shapes from trust_edges + received listings. Positioning (`deg`),
// via-threading (`viaId`) and per-node context (`ctx`) travel with the data so
// the ring/People/reach views stay screen-agnostic.

/** Ring-1 = people you've met (trust edges). @type {any[]} */
const RING1_SEED = [
  { id: "lucia", n: "Lucía", lvl: "Close friend", deg: 210, offer: "speakers", ctx: "Biodanza — Casa Luna · May" },
  { id: "rafa", n: "Rafa", lvl: "Friend", deg: 330, ctx: "Ecstatic Dance Palermo · June" },
];
/** Ring-2 = people/offers one hop out, always shown with their via-path. @type {any[]} */
const RING2_SEED = [
  { id: "bruno", n: "Bruno", via: "Lucía", viaId: "lucia", deg: 235, asym: true },
];
/** Maria joins ring-1 after the ceremony; her second ring appears with her. */
const MARIA_RING1 = { id: "maria", n: "Maria", deg: 90, ctx: "Ecstatic Dance Palermo · today" };
/** @type {any[]} */
const MARIA_RING2 = [
  { id: "sofia", n: "Sofía", via: "Maria", viaId: "maria", deg: 55 },
  { id: "nico", n: "Nico", via: "Maria", viaId: "maria", deg: 125 },
  { anon: true, offer: "a projector", via: "Maria", viaId: "maria", deg: 160 },
];

/** People list rows. @type {any[]} */
const PEOPLE_SEED = [
  { id: "lucia", n: "Lucía", c: "Biodanza — Casa Luna · May", s: "mutual", sl: "Connected" },
  { id: "rafa", n: "Rafa", c: "Ecstatic Dance Palermo · June", s: "mutual", sl: "Connected" },
  { id: "tomas", n: "Tomás", c: "Contact Improv Jam · June", s: "out", sl: "Pending" },
];
const MARIA_PERSON = { id: "maria", n: "Maria", c: "Ecstatic Dance Palermo · today", s: "mutual", sl: "Connected" };

/** Names visible per tier (before Maria). @type {Record<string, string[]>} */
const REACH_NAMES = { commons: ["Lucía", "Rafa", "Tomás", "Bruno"], friends: ["Lucía", "Rafa"], close: ["Lucía"] };

/** The canned "person in front of you" for the fixture ceremony. */
const FIXTURE_PENDING_MEET = {
  card: { peer: "maria", display: "Maria" },
  display: "Maria",
  initial: "M",
  ctxLabel: "☀ Ecstatic Dance Palermo · today",
};

/** @typedef {ReturnType<typeof createApiClient>} ApiClient */

/**
 * @param {{ mode?: "fixture" | "live", agentUrl?: string }} [opts]
 */
export function createApiClient(opts = {}) {
  const mode = opts.mode || "fixture";
  const agentUrl = opts.agentUrl;

  // Live mode: the same interface, fed by the persona's agent-daemon over
  // REST + WS. Fixture mode reproduces the designer's demo exactly. The cast
  // keeps the fixture client's precise type as the canonical ApiClient shape,
  // so screens keep their inferred getState() typing regardless of mode.
  if (mode === "live") {
    return /** @type {ReturnType<typeof createFixtureClient>} */ (
      createLiveClient(agentUrl || "http://localhost:4101")
    );
  }
  return createFixtureClient(mode, agentUrl);
}

/**
 * The fixture ApiClient — the designer's demo data + simulated timers behind
 * the shared interface.
 * @param {string} mode
 * @param {string | undefined} agentUrl
 */
function createFixtureClient(mode, agentUrl) {
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
    const met = state.met;
    const mariaLvl = state.mariaLevel || "Friend";
    const ring1 = RING1_SEED.map((x) => ({ ...x }));
    const ring2 = RING2_SEED.map((x) => ({ ...x }));
    const people = PEOPLE_SEED.map((x) => ({ ...x }));
    if (met) {
      ring1.push({ ...MARIA_RING1, lvl: mariaLvl });
      MARIA_RING2.forEach((x) => ring2.push({ ...x }));
      people.unshift({ ...MARIA_PERSON });
    }
    /** @type {Record<string, string[]>} */
    const reachNames = {
      commons: [...REACH_NAMES.commons, ...(met ? ["Maria"] : [])],
      friends: [...REACH_NAMES.friends, ...(met ? ["Maria"] : [])],
      close: [...REACH_NAMES.close, ...(met && state.mariaLevel === "Close friend" ? ["Maria"] : [])],
    };
    const pendingMeet = state.pendingMeet || FIXTURE_PENDING_MEET;
    const lucia = threads.lucia;
    /** @type {any[]} */
    const threadList = [{ id: "lucia", n: "Lucía", last: lucia[lucia.length - 1][1] }];
    if (met) threadList.unshift({ id: "maria", n: "Maria", last: threads.maria[threads.maria.length - 1][1] });
    return {
      ...state, events, privateEvent, offers, threads, threadList, vis: VIS, reach: REACH,
      people, rings: { ring1, ring2 }, reachNames, pendingMeet, myCard: null,
    };
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
   * @param {import("./store.js").MeetCard | string} card
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

  /**
   * Add a second-brain note. Fixture mode has no store, so this is inert; the
   * live client POSTs /api/notes. Kept on the interface so screens call the
   * same method in both modes.
   * @param {any} fields
   * @returns {Promise<null>}
   */
  function addNote(fields) {
    void fields;
    return Promise.resolve(null);
  }

  /**
   * Resolve a scanned/pasted meet card (live). Fixture keeps the canned
   * ceremony, so this is a no-op that leaves the demo's Maria in place.
   * @param {string} text
   * @returns {boolean}
   */
  function resolveCard(text) {
    void text;
    return true;
  }

  /** Live-mode boot hook (fetch + WS). Fixture has nothing to fetch. */
  function start() {}

  return {
    mode, agentUrl,
    getState, subscribe, offerById, seed, start,
    publishListing, requestBorrow, loanAction,
    sendDm, addTrust, setVisibilityDial, sendSteward, addNote, resolveCard,
  };
}
