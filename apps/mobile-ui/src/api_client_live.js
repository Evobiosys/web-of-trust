// @ts-check
// The live ApiClient: the SAME interface the fixture client exposes, fed by the
// persona's agent-daemon over REST + WS (docs/API.md). Screens never learn
// which mode they run in — getState() returns the identical state bag shape the
// fixture produces, normalized from the daemon's snapshot.
//
// Data flow: any mutation POSTs to the daemon, which broadcasts a WS
// `state_changed`; the client refetches /api/state (a superset that already
// carries listings, loans, and threads) + /api/card once, normalizes into the
// bag, writes it through the shared store singleton, and notify()s. Every
// mutating method also awaits an immediate refresh() so the UI updates even
// when the WS is slow or absent (e.g. under mocked-fetch unit tests).

import { state, subscribe, notify } from "./store.js";
import { VIS, REACH } from "./api_client.js";
import { showCoach } from "./coach.js";

// -- small mappers between the UI's vocabulary and the daemon's -----------------

/** UI level label → daemon trust level. @type {Record<string, string>} */
const LEVEL_UI_TO_API = { Contact: "contact", Friend: "friend", "Close friend": "close" };
/** Daemon trust level → UI level label (I9: absent level defaults to friend). @type {Record<string, string>} */
const LEVEL_API_TO_UI = { contact: "Contact", friend: "Friend", close: "Close friend" };
/** Host tier picker key → daemon listing tier. @type {Record<string, string>} */
const VIS_TO_TIER = { pub: "public", commons: "wot_commons", friends: "trusted", close: "close" };
/** Daemon tier → offer/gathering label shown on cards. @type {Record<string, string>} */
const TIER_LABEL = { public: "Public", wot_commons: "Commons", trusted: "Friends", close: "Close friends", private: "Private" };
/** UI loan action → daemon loan state. @type {Record<string, string>} */
const LOAN_UI_TO_API = { returned: "returned", complete: "complete", notyet: "not_yet", approved: "approved", declined: "declined", lent: "lent" };

/** HTML-escape untrusted daemon strings (display names, DM text) before they
 * reach a screen's innerHTML. The fixture data is trusted; live data is not. */
/** @param {any} v */
function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (/** @type {string} */ c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c
  ));
}

/** @param {any} lvl */
function levelUi(lvl) {
  return LEVEL_API_TO_UI[lvl] || "Friend";
}

/** @returns {any} an empty snapshot so getState() is safe before the first fetch. */
function emptySnapshot() {
  return {
    persona: { name: state.name || "You" },
    trust_edges: [], listings_mine: [], listings_received: [],
    loans: [], threads: [], consent_cards: [], steward_log: [],
  };
}

/**
 * The live ApiClient.
 * @param {string} agentUrl
 */
export function createLiveClient(agentUrl) {
  const base = agentUrl.replace(/\/+$/, "");
  const mode = "live";

  /** @type {any} */
  let snapshot = emptySnapshot();
  /** @type {any} */
  let myCard = null;
  /** @type {any} */
  let bag = normalize(snapshot);
  /** @type {WebSocket | null} */
  let ws = null;
  let started = false;

  // ------------------------------------------------------------- transport --

  /** @param {string} path @param {any} [body] @param {string} [method] */
  async function req(path, body, method) {
    const res = await fetch(base + path, {
      method: method || (body ? "POST" : "GET"),
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(json && json.error ? json.error : "HTTP " + res.status);
    return json;
  }

  // ------------------------------------------------------ error surface ----
  // Finding 3: failed mutations must never fail silently. One shared spot —
  // every mutating method funnels its request promise through `mutate()`, so
  // screens keep their fire-and-forget calls (activity-card actions,
  // addTrust, requestBorrow, sendDm, publishListing, …) with no per-callsite
  // try/catch. Reuses the existing coach chip (dismissible via its own ✕).

  /** @param {unknown} err */
  function reportMutationError(err) {
    // eslint-disable-next-line no-console
    console.error("[live] mutation failed:", err);
    showCoach("That didn’t go through — try again.");
  }

  /**
   * Wrap a mutating request promise: refetch state on success (awaited, same
   * as before), surface a dismissible error (and log the detail) on failure
   * — never rejects, so fire-and-forget call sites stay fire-and-forget.
   * @param {Promise<any>} p
   * @returns {Promise<void>}
   */
  function mutate(p) {
    return p.then(refresh).catch((err) => { reportMutationError(err); });
  }

  // -------------------------------------------------------- normalization --

  /**
   * Map the daemon snapshot into the state bag the screens expect. Pure: takes
   * a snapshot, returns the derived collections (activity is written onto the
   * store separately so both `state.activity` and getState() agree).
   * @param {any} snap
   */
  function normalize(snap) {
    /** @type {any[]} */
    const edges = snap.trust_edges || [];
    /** @type {any[]} */
    const recv = snap.listings_received || [];
    /** @type {any[]} */
    const mine = snap.listings_mine || [];
    /** @type {any[]} */
    const loans = snap.loans || [];

    // -- offers: my active offers + received active offers ------------------
    /** @type {any[]} */
    const offers = [];
    for (const l of mine) {
      if (l.kind !== "offer" || l.state !== "active") continue;
      offers.push({
        id: l.listing_id, t: esc(l.title), d: esc(l.description), owner: "You", mine: true,
        tier: TIER_LABEL[l.tier] || l.tier, state: offerLoanState(loans, l.listing_id),
      });
    }
    for (const l of recv) {
      if (l.kind !== "offer" || l.state !== "active") continue;
      const viaChain = (l.via || []).length > 0;
      offers.push({
        id: l.listing_id, t: esc(l.title), d: esc(l.description), owner: esc(l.owner_display),
        ownerId: l.from_peer, tier: TIER_LABEL[l.tier] || l.tier,
        state: offerLoanState(loans, l.listing_id),
        via: viaChain ? esc(l.owner_display) : undefined,
      });
    }

    // -- gatherings (events): my active gatherings first, then received -----
    /** @type {any[]} */
    const events = [];
    for (const l of mine) {
      if (l.kind !== "gathering" || l.state !== "active") continue;
      const pub = l.tier === "public";
      events.push({
        t: esc(l.title), m: whenWhere(l) + " · you host this",
        b: pub ? "pub" : "priv", bl: (pub ? "Public" : TIER_LABEL[l.tier]) + " · yours",
        via: pub ? undefined : "☾ Doors: " + (TIER_LABEL[l.tier] || "").toLowerCase() + ", within " + (l.steps || 1) + " step" + ((l.steps || 1) > 1 ? "s" : ""),
        hosted: true,
      });
    }
    for (const l of recv) {
      if (l.kind !== "gathering" || l.state !== "active") continue;
      const pub = l.tier === "public";
      const viaChain = (l.via || []).length > 0;
      events.push({
        t: esc(l.title), m: whenWhere(l),
        b: pub ? "pub" : "priv", bl: pub ? "Public" : (TIER_LABEL[l.tier] || l.tier),
        // Always set `via` so discover.js's fixture-flavoured "via Maria"
        // fallback never fires on live data.
        via: viaChain ? "via " + esc(l.owner_display) : "Shared with your web",
      });
    }

    // -- threads + thread list ---------------------------------------------
    /** @type {Record<string, Array<[string, string]>>} */
    const threads = {};
    /** @type {any[]} */
    const threadList = [];
    for (const t of snap.threads || []) {
      /** @type {Array<[string, string]>} */
      const arr = (t.messages || []).map((/** @type {any} */ m) => [m.direction === "outgoing" ? "me" : "them", esc(m.text)]);
      threads[t.peer_id] = arr;
      threadList.push({ id: t.peer_id, n: esc(t.display), last: arr.length ? arr[arr.length - 1][1] : "" });
    }
    // Steward replies surface as a pseudo-thread named after the agent.
    if ((snap.steward_log || []).length) {
      /** @type {Array<[string, string]>} */
      const sarr = snap.steward_log.map((/** @type {any} */ e) => [e.role === "user" ? "me" : "them", esc(e.text)]);
      threads.__steward__ = sarr;
      threadList.unshift({ id: "__steward__", n: "Your agent", last: sarr[sarr.length - 1][1] });
    }

    // -- people (ring 1 roster) --------------------------------------------
    /** @type {any[]} */
    const people = edges.map((e) => ({
      id: e.peer, n: esc(e.display), c: levelUi(e.level) + " · met in person", s: "mutual", sl: "Connected",
    }));

    // -- rings: ring 1 = trust edges; ring 2 = received via-chain listings --
    const ring1 = edges.map((e, i) => ({
      id: e.peer, n: esc(e.display), lvl: levelUi(e.level),
      deg: Math.round((360 / Math.max(1, edges.length)) * i), ctx: levelUi(e.level) + " · met in person",
    }));
    /** @type {any[]} Ring 2: only honest via-chain listings (I2 — nothing anonymous invented pre-consent). */
    const ring2Src = recv.filter((l) => (l.via || []).length > 0);
    const ring2 = ring2Src.map((l, i) => ({
      id: l.listing_id + ":via", n: esc(l.owner_display), via: esc(fromDisplay(edges, l.from_peer)),
      viaId: l.from_peer, deg: 20 + Math.round((320 / Math.max(1, ring2Src.length)) * i),
    }));

    // -- reach names per host tier -----------------------------------------
    /** @param {(e: any) => boolean} pred */
    const names = (pred) => edges.filter(pred).map((e) => esc(e.display));
    const isClose = (/** @type {any} */ e) => e.level === "close";
    const isTrusted = (/** @type {any} */ e) => e.level === "close" || e.level === "friend" || e.level == null;
    /** @type {Record<string, string[]>} */
    const reachNames = {
      commons: names(() => true),
      friends: names(isTrusted),
      close: names(isClose),
    };

    // -- activity: loans awaiting me + pending consent cards ----------------
    // Kept in the per-client bag (not the shared store singleton) so multiple
    // live clients in one process — e.g. the two-daemon integration test — do
    // not clobber each other's activity feed.
    const activity = buildActivity(loans, snap.consent_cards || [], mine, recv);

    return { events, offers, threads, threadList, people, rings: { ring1, ring2 }, reachNames, activity };
  }

  /** @param {any[]} loans @param {string} listingId */
  function offerLoanState(loans, listingId) {
    const loan = loans.find((l) => l.listing_id === listingId && l.state !== "declined" && l.state !== "complete");
    if (!loan) return "available";
    if (loan.state === "requested" || loan.state === "approved") return "requested";
    if (loan.state === "lent") return "lent";
    return "available";
  }

  /** @param {any} l */
  function whenWhere(l) {
    return [l.when, l.where_public || l.where_gated].filter(Boolean).join(" · ") || "Details on arrival";
  }

  /** @param {any[]} edges @param {string} peer */
  function fromDisplay(edges, peer) {
    const e = edges.find((x) => x.peer === peer);
    return e ? e.display : peer;
  }

  /**
   * Build the "Waiting on you" activity feed from real loans + consent cards.
   * @param {any[]} loans @param {any[]} cards @param {any[]} mine @param {any[]} recv
   */
  function buildActivity(loans, cards, mine, recv) {
    /** @param {string} id */
    const title = (id) => {
      const m = mine.find((l) => l.listing_id === id) || recv.find((l) => l.listing_id === id);
      return m ? m.title : "the item";
    };
    /** @type {any[]} */
    const items = [];
    const sorted = loans.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    for (const loan of sorted) {
      const who = esc(loan.counterparty.display);
      const t = esc(title(loan.listing_id));
      const id = loan.loan_id;
      if (loan.state === "returned") {
        items.push({
          icon: "🌀", who: "Completion", loanId: id, phase: "completion",
          txt: "The " + t.toLowerCase() + " is back with " + who + ". Do you feel complete?",
          actions: [
            { label: "Complete", kind: "electric", fn: () => loanAction(id, "complete") },
            { label: "Not yet — say more", kind: "ghost", fn: () => loanAction(id, "notyet") },
          ],
        });
      } else if (loan.role === "owner" && loan.state === "requested") {
        items.push({
          icon: "📦", who, loanId: id, phase: "request",
          txt: who + " would like to borrow your <b>" + t + "</b>.",
          actions: [
            { label: "Approve", kind: "electric", fn: () => loanAction(id, "approved") },
            { label: "Not now", kind: "ghost", fn: () => loanAction(id, "declined") },
          ],
        });
      } else if (loan.role === "owner" && loan.state === "approved") {
        items.push({
          icon: "🤝", who, loanId: id, phase: "approved",
          txt: "You said yes to " + who + " for the <b>" + t + "</b>. Hand it over when you meet.",
          actions: [{ label: "Mark handed over", kind: "coral", fn: () => loanAction(id, "lent") }],
        });
      } else if (loan.role === "borrower" && loan.state === "lent") {
        items.push({
          icon: "🔊", who, loanId: id, phase: "lent",
          txt: who + " lent you the <b>" + t + "</b>. Arrange pickup — and bring it back whole.",
          actions: [{ label: "Mark returned", kind: "coral", fn: () => loanAction(id, "returned") }],
        });
      }
    }
    for (const c of cards) {
      if (c.state !== "pending") continue;
      const label = (c.matched_item && c.matched_item.labels && c.matched_item.labels[0]) || "a match";
      const who = c.kind === "relay" ? "Someone via " + esc(c.requester.display) : esc(c.requester.display);
      items.push({
        icon: "🔎", who,
        txt: esc(c.text) + " — you have <b>" + esc(label) + "</b>. Share it?",
        actions: [
          { label: "Share", kind: "electric", fn: () => consent(c.card_id) },
          { label: "Not this time", kind: "ghost", fn: () => decline(c.card_id) },
        ],
      });
    }
    return items;
  }

  // ------------------------------------------------------------- refresh --

  async function refresh() {
    try {
      snapshot = await req("/api/state");
      if (snapshot.persona && snapshot.persona.name) state.name = snapshot.persona.name;
      if (!myCard) {
        try { myCard = await req("/api/card"); } catch { myCard = null; }
      }
      bag = normalize(snapshot);
      notify();
    } catch (err) {
      // Keep the last-known bag on a transient failure rather than blanking the UI.
      // eslint-disable-next-line no-console
      console.error("[live] refresh failed:", err);
    }
  }

  // ------------------------------------------------------------ getState --

  function getState() {
    return {
      ...state, ...bag,
      privateEvent: null, vis: VIS, reach: REACH,
      myCard, pendingMeet: state.pendingMeet || null,
      // Finding 1: no real intro-suggestion feature yet — never invent one.
      introSuggestions: [],
    };
  }

  /** @param {string} id */
  function offerById(id) {
    return bag.offers.find((/** @type {any} */ o) => o.id === id);
  }

  // -------------------------------------------------------------- methods --

  /**
   * Ceremony confirm → create a mutual-side trust edge. Sets the celebration
   * flags synchronously (the meet screen reads state.unlocked right after) then
   * POSTs and refetches.
   * @param {any} card @param {string} level
   */
  function addTrust(card, level) {
    const peer = typeof card === "string" ? card : card.peer;
    const display = typeof card === "string" ? card : (card.display || peer);
    state.met = true;
    state.mariaLevel = level;
    state.unlocked = level !== "Contact";
    state.justUnlocked = state.unlocked;
    return mutate(req("/api/trust", { peer, display, level: LEVEL_UI_TO_API[level] || "friend" }));
  }

  /** @param {any} listing host form: { t, m, when, where, vis, steps } */
  function publishListing(listing) {
    state.justHosted = true;
    const tier = VIS_TO_TIER[listing.vis] || "trusted";
    const where = listing.where || undefined;
    const body = {
      kind: "gathering", title: listing.t,
      description: listing.m || listing.when || listing.t || "Gathering",
      when: listing.when, tier, steps: listing.steps,
      ...(tier === "public" ? { where_public: where } : { where_gated: where }),
    };
    return mutate(req("/api/listings", body));
  }

  /** @param {string} listingId */
  function requestBorrow(listingId) {
    return mutate(req("/api/borrow", { listing_id: listingId }));
  }

  /** Withdraw one of my own listings — receivers flip it to withdrawn. @param {string} listingId */
  function withdrawListing(listingId) {
    return mutate(req("/api/listings/" + encodeURIComponent(listingId) + "/withdraw", {}));
  }

  /** @param {string} loanId @param {string} uiState */
  function loanAction(loanId, uiState) {
    return mutate(req("/api/loans/" + encodeURIComponent(loanId), { state: LOAN_UI_TO_API[uiState] || uiState }));
  }

  /** @param {string} cardId */
  function consent(cardId) {
    return mutate(req("/api/consent", { card_id: cardId }));
  }
  /** @param {string} cardId */
  function decline(cardId) {
    return mutate(req("/api/decline", { card_id: cardId }));
  }

  /** @param {string} peer @param {string} text */
  function sendDm(peer, text) {
    if (!text) return Promise.resolve();
    return mutate(req("/api/threads/" + encodeURIComponent(peer) + "/message", { text }));
  }

  /** @param {string} text */
  function sendSteward(text) {
    return req("/api/steward", { text }).then(async (r) => {
      await refresh();
      return (r && r.reply) || null;
    }).catch((err) => { reportMutationError(err); return null; });
  }

  /** @param {any} fields */
  function addNote(fields) {
    return req("/api/notes", fields).then(async (r) => {
      await refresh();
      return (r && r.item_id) || null;
    }).catch((err) => { reportMutationError(err); return null; });
  }

  /** Visibility dial has no daemon field yet — keep it client-side. @param {boolean} on */
  function setVisibilityDial(on) {
    state.visibilityDial = !!on;
    notify();
    // TODO(daemon): persist the outbound-visibility dial once the daemon
    // exposes a per-persona visibility field (none in Task 5's surface).
  }

  /**
   * Resolve a scanned/pasted meet card (compact JSON from the peer's QR) into
   * the pending-confirm person. Returns false on unparseable input so the
   * screen can keep the manual-entry field open.
   * @param {string} text
   */
  function resolveCard(text) {
    try {
      const c = JSON.parse(text);
      const peer = c.peer_id || c.peer;
      if (!peer) return false;
      const display = c.display || peer;
      state.pendingMeet = {
        card: { peer, display },
        display,
        initial: String(display).charAt(0).toUpperCase() || "?",
        ctxLabel: "☀ Met just now",
      };
      notify();
      return true;
    } catch {
      return false;
    }
  }

  // Ceremony default level, from the daemon's I9 conservative hint.
  function seed() {
    void start();
  }

  /** Boot: initial fetch + open the WS. Idempotent. */
  function start() {
    if (started) return;
    started = true;
    void refresh();
    openWs();
  }

  // Finding 4: the daemon can restart, the network can blip, a laptop can
  // sleep — a WS that never reconnects silently stops delivering pushes
  // until the next full page reload. Reconnect with capped exponential
  // backoff (1s → 2s → 4s → … → 15s), reset on a successful open, and
  // refetch state on every (re)open so a missed broadcast during the outage
  // is never lost.
  const BASE_BACKOFF_MS = 1000;
  const MAX_BACKOFF_MS = 15000;
  let backoff = BASE_BACKOFF_MS;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;
  let stopped = false;

  function openWs() {
    if (stopped || typeof WebSocket === "undefined") return;
    let wsUrl;
    try {
      const u = new URL(base);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.pathname = "/ws";
      wsUrl = u.toString();
    } catch {
      wsUrl = base.replace(/^http/, "ws") + "/ws";
    }
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      ws = null;
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      backoff = BASE_BACKOFF_MS; // the connection is healthy again — reset the backoff
      void refresh(); // catch up on anything broadcast while we were disconnected
    };
    // Any event is a hint to refetch; state_changed is the only one we need.
    ws.onmessage = () => { void refresh(); };
    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };
    ws.onerror = () => {};
  }

  /** Schedule the next reconnect attempt, doubling the backoff (capped). */
  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = backoff;
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openWs();
    }, delay);
  }

  /** Tear down: stop reconnecting and close any live socket. Test/dev cleanup hook. */
  function stop() {
    stopped = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) {
      try { ws.close(); } catch { /* already closing */ }
      ws = null;
    }
  }

  return {
    mode, agentUrl: base,
    getState, subscribe, offerById, seed, start, stop, refresh,
    publishListing, requestBorrow, loanAction, withdrawListing,
    sendDm, addTrust, setVisibilityDial, sendSteward, addNote, resolveCard,
  };
}
