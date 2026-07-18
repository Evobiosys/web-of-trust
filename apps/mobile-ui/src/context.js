// @ts-check
// Shared app context: the wiring the screens reach for (navigation, sheets,
// the api client, the cross-screen thread opener, the dynamic-refresh hook).
// main.js populates this at boot; tests populate the pieces they exercise.
// Keeping it a leaf module avoids circular imports between screens and nav.

/**
 * @typedef {import("./api_client.js").ApiClient} ApiClient
 *
 * @typedef {Object} AppContext
 * @property {ApiClient} api
 * @property {(id: string) => void} show
 * @property {(html: string) => void} openSheet
 * @property {() => void} closeSheet
 * @property {(id: string, name: string) => void} openThread
 * @property {() => void} refresh
 */

/** @type {AppContext} */
export const ctx = /** @type {AppContext} */ ({
  api: /** @type {any} */ (null),
  show: () => {},
  openSheet: () => {},
  closeSheet: () => {},
  openThread: () => {},
  refresh: () => {},
});
