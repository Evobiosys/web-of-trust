// @ts-check
// Resolves mobile-ui's runtime configuration: which agent to talk to, which
// app profile to skin as, and which persona is "you". Mirrors device-ui's
// runtime_config.ts precedence (query > localStorage > defaults), minus the
// VITE_* env layer device-ui has (mobile-ui isn't built per-persona today).
//
// Deliberately returns the raw `appId` string, not a resolved AppProfile —
// callers (boot code) resolve the profile themselves via
// `@resource-web/app-profiles`'s `getProfile`, keeping this module free of
// that dependency.

/** localStorage keys the resolved runtime config is persisted under, so a
 * value delivered via URL query param on one load (e.g. a QR-code deep
 * link) survives subsequent loads that carry no query string. */
const STORAGE_KEYS = {
  agentUrl: "resource-web.runtime_config.agentUrl",
  appId: "resource-web.runtime_config.appId",
  personaKey: "resource-web.runtime_config.personaKey",
  mode: "resource-web.runtime_config.mode",
  // QR-onboarding Task 5: the scanned connect URL's `?connect=<origin DID>` +
  // `?relay=<mediator base origin>`. Persisted like the rest so a bare reload
  // after the first scan still carries the connect intent (identity + the
  // in-flight/established connection survive) — see main.js's connect branch.
  connect: "resource-web.runtime_config.connect",
  relay: "resource-web.runtime_config.relay",
};

const DEFAULTS = {
  agentUrl: "http://localhost:4101",
  appId: "ecstatic",
  personaKey: "anna",
  // "fixture" keeps the designer's demo reachable by default; "live" wires the
  // real agent-daemon. The alpha build opts in with `?mode=live`.
  mode: "fixture",
};

// Some environments expose `window.localStorage` but throw (or return
// undefined) on access — Safari private-browsing mode, storage disabled by
// policy, or (in this repo's test environment) Node's experimental global
// `localStorage` shadowing jsdom's without a backing file. In all of those
// cases we degrade to a module-lifetime in-memory store rather than crash:
// query params still work every load; only cross-load persistence is lost.
/** @type {Map<string, string> | undefined} */
let memoryFallback;

/** @returns {Map<string, string>} */
function getFallbackStore() {
  if (!memoryFallback) memoryFallback = new Map();
  return memoryFallback;
}

/** @param {string} key @returns {string | undefined} */
function readStorage(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? undefined : value;
  } catch {
    return getFallbackStore().get(key);
  }
}

/** @param {string} key @param {string} value */
function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    getFallbackStore().set(key, value);
  }
}

/** @param {string} key */
function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    getFallbackStore().delete(key);
  }
}

/**
 * Forget the persisted connect intent (`connect` + `relay`). Called after a
 * declined CONNECT so a later bare reload lands on normal onboarding instead
 * of re-sending a CONNECT to an origin that already said no (Task 5). Leaves
 * every other runtime-config key untouched.
 */
export function clearConnectConfig() {
  removeStorage(STORAGE_KEYS.connect);
  removeStorage(STORAGE_KEYS.relay);
}

/**
 * @typedef {Object} RuntimeConfig
 * @property {string} agentUrl
 * @property {string} appId
 * @property {string} personaKey
 * @property {"fixture" | "live"} mode
 * @property {string} [connect] - origin DID a scanned connect URL wants to join (Task 5). Undefined for the normal (non-connect) flow.
 * @property {string} [relay] - mediator relay base ORIGIN the connect flow submits/drains through (Task 5). Only meaningful alongside `connect`.
 */

/**
 * Resolves mobile-ui's runtime configuration.
 *
 * Precedence (highest first): URL query params (`?agent=…&app=…&persona=…`)
 * > localStorage > hard defaults (`http://localhost:4101`, `ecstatic`,
 * `anna`).
 *
 * Any query param present on this load is persisted to localStorage so it
 * survives later loads that carry no query string (e.g. after a QR-code
 * onboarding link is opened once).
 *
 * @returns {RuntimeConfig}
 */
export function getRuntimeConfig() {
  const params = new URLSearchParams(window.location.search);
  const queryAgent = params.get("agent") ?? undefined;
  const queryApp = params.get("app") ?? undefined;
  const queryPersona = params.get("persona") ?? undefined;
  const queryConnect = params.get("connect") ?? undefined;
  const queryRelay = params.get("relay") ?? undefined;
  const queryModeRaw = params.get("mode") ?? undefined;
  const queryMode = queryModeRaw === "live" || queryModeRaw === "fixture" ? queryModeRaw : undefined;

  // An explicit `agent` URL means "talk to this real backend" — infer live mode
  // so the alpha launcher's join URLs (which carry ?agent= but not ?mode=) work
  // without every friend remembering to append &mode=live. An explicit
  // ?mode=fixture still wins for anyone who wants the offline mock.
  const inferredMode = queryMode ?? (queryAgent ? "live" : undefined);

  if (queryAgent) writeStorage(STORAGE_KEYS.agentUrl, queryAgent);
  if (queryApp) writeStorage(STORAGE_KEYS.appId, queryApp);
  if (queryPersona) writeStorage(STORAGE_KEYS.personaKey, queryPersona);
  if (queryConnect) writeStorage(STORAGE_KEYS.connect, queryConnect);
  if (queryRelay) writeStorage(STORAGE_KEYS.relay, queryRelay);
  if (inferredMode) writeStorage(STORAGE_KEYS.mode, inferredMode);

  const agentUrl = queryAgent ?? readStorage(STORAGE_KEYS.agentUrl) ?? DEFAULTS.agentUrl;
  const appId = queryApp ?? readStorage(STORAGE_KEYS.appId) ?? DEFAULTS.appId;
  const personaKey = queryPersona ?? readStorage(STORAGE_KEYS.personaKey) ?? DEFAULTS.personaKey;
  const connect = queryConnect ?? readStorage(STORAGE_KEYS.connect);
  const relay = queryRelay ?? readStorage(STORAGE_KEYS.relay);
  const storedMode = readStorage(STORAGE_KEYS.mode);
  const mode = /** @type {"fixture" | "live"} */ (
    inferredMode ?? (storedMode === "live" || storedMode === "fixture" ? storedMode : DEFAULTS.mode)
  );

  return { agentUrl, appId, personaKey, mode, connect, relay };
}
