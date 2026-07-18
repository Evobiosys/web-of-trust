// @ts-check
// The mockup's `state` object + a tiny pub/sub. This is the single reactive
// store the screens read UI state from and the ApiClient mutates. No fixtures
// live here — those are owned by api_client.js.

/**
 * @typedef {Object} ActivityAction
 * @property {string} label
 * @property {string} [kind]
 * @property {(item: ActivityItem) => void} fn
 *
 * @typedef {Object} ActivityItem
 * @property {string} who
 * @property {string} txt
 * @property {string} [icon]
 * @property {string} [anchor]
 * @property {boolean} [done]
 * @property {string} [res]
 * @property {string} [loanId]
 * @property {string} [phase]
 * @property {ActivityAction[]} [actions]
 *
 * @typedef {Object} HostedEvent
 * @property {string} t
 * @property {string} m
 * @property {string} vis
 * @property {number} steps
 * @property {string} [when]
 * @property {string} [where]
 *
 * @typedef {Object} AppState
 * @property {string} name
 * @property {boolean} met
 * @property {boolean} unlocked
 * @property {string | null} mariaLevel
 * @property {string} screen
 * @property {string} offerLevel
 * @property {string} chan
 * @property {boolean} adv
 * @property {boolean} permCtx
 * @property {boolean} permOffers
 * @property {boolean} permRing
 * @property {boolean} visibilityDial
 * @property {string} [signup]
 * @property {boolean} [guest]
 * @property {boolean} [seeded]
 * @property {HostedEvent} [hosted]
 * @property {boolean} [justUnlocked]
 * @property {boolean} [justHosted]
 * @property {string} [introDone]
 * @property {PendingMeet} [pendingMeet]
 * @property {ActivityItem[]} activity
 *
 * @typedef {Object} MeetCard
 * @property {string} peer
 * @property {string} display
 *
 * @typedef {Object} PendingMeet
 * @property {MeetCard} card
 * @property {string} display
 * @property {string} initial
 * @property {string} ctxLabel
 */

/** @returns {AppState} */
function initialState() {
  return {
    name: "You",
    met: false,
    unlocked: false,
    mariaLevel: null,
    screen: "onb",
    offerLevel: "Contact",
    chan: "qr",
    adv: false,
    permCtx: true,
    permOffers: true,
    permRing: true,
    visibilityDial: true,
    activity: [],
  };
}

/** @type {AppState} */
export const state = initialState();

/** Reset the singleton state in place (keeps imported references valid). */
export function resetState() {
  const fresh = initialState();
  for (const k of Object.keys(state)) {
    // @ts-ignore - dynamic clear
    delete state[k];
  }
  Object.assign(state, fresh);
  subscribers.length = 0;
}

/** @type {Array<() => void>} */
const subscribers = [];

/**
 * Subscribe to store changes. Returns an unsubscribe function.
 * @param {() => void} cb
 * @returns {() => void}
 */
export function subscribe(cb) {
  subscribers.push(cb);
  return () => {
    const i = subscribers.indexOf(cb);
    if (i >= 0) subscribers.splice(i, 1);
  };
}

/** Notify all subscribers that state changed. */
export function notify() {
  for (const cb of subscribers.slice()) cb();
}
