// @ts-check
// Placeholder — the live ApiClient lands in step 2. Kept as a separate module
// so the fixture client (api_client.js) can import it unconditionally without
// dragging live-only code (fetch/WS) into the fixture code path.

/**
 * @param {string} agentUrl
 * @returns {any}
 */
export function createLiveClient(agentUrl) {
  void agentUrl;
  throw new Error("live ApiClient not yet implemented");
}
