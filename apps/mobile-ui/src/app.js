// @ts-check
// Wires the app against the current DOM: creates the fixture ApiClient,
// populates the shared context, subscribes the targeted refresh, and binds the
// chrome. main.js calls this then opens onboarding; tests call it against a
// freshly-mounted DOM. Kept free of CSS imports so it runs under jsdom.

import { $ } from "./dom.js";
import { subscribe, state } from "./store.js";
import { createApiClient } from "./api_client.js";
import { ctx } from "./context.js";
import { show } from "./nav.js";
import { openSheet, closeSheet, initSheet } from "./sheet.js";
import { initSpec } from "./spec_mode.js";
import { initCoach } from "./coach.js";
import { updateBell, renderActivity, openThread } from "./screens/chat.js";
import { renderOffers, initDiscover } from "./screens/discover.js";
import { renderYou, initYou } from "./screens/you.js";
import { initMeet } from "./screens/meet.js";
import { initSettings } from "./screens/settings.js";
import { initOnboarding } from "./screens/onboarding.js";

/**
 * Wire everything against the current document. Returns the shared context.
 * @param {{ mode?: "fixture" | "live", agentUrl?: string }} [opts]
 */
export function bootApp(opts = {}) {
  ctx.api = createApiClient({ mode: opts.mode || "fixture", agentUrl: opts.agentUrl });
  ctx.show = show;
  ctx.openSheet = openSheet;
  ctx.closeSheet = closeSheet;
  ctx.openThread = openThread;

  // Targeted refresh: bell always; the active data screen re-renders.
  function refresh() {
    updateBell();
    if (state.screen === "chat") renderActivity();
    else if (state.screen === "discover") renderOffers();
    else if (state.screen === "you") renderYou();
  }
  ctx.refresh = refresh;
  subscribe(refresh);

  $("tabs").addEventListener("click", (e) => {
    const target = /** @type {Element} */ (e.target);
    const b = target.closest("[data-go]");
    if (b) show(b.getAttribute("data-go") || "discover");
  });

  initSheet();
  initSpec();
  initCoach();
  initDiscover();
  initMeet();
  initYou();
  initSettings();
  initOnboarding();

  return ctx;
}
