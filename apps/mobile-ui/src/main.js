// @ts-check
// Browser entry: styles + boot + skin + open onboarding (the golden path start).

import "./styles.css";
import { bootApp } from "./app.js";
import { onb, finishOnb } from "./screens/onboarding.js";
import { state } from "./store.js";
import { getRuntimeConfig } from "./runtime_config.js";
import { applySkin } from "./skin.js";
import { getProfile } from "@resource-web/app-profiles";
import { runConnectFlow, hasEstablishedConnection, enterEstablishedConnection } from "./screens/connect_flow.js";
import { loadOrCreateIdentity, createRelayClient } from "@resource-web/browser-agent";

const runtimeConfig = getRuntimeConfig();
const appCtx = bootApp({ mode: runtimeConfig.mode, agentUrl: runtimeConfig.agentUrl });
applySkin(getProfile(runtimeConfig.appId));
// Live mode boots its REST/WS connection immediately; fixture's start() is a
// no-op, so this is safe in both modes. (Onboarding also calls seed(), which
// live aliases to start() — start() is idempotent.)
appCtx.api.start();

// Boot branch (highest precedence first):
//  1. An ESTABLISHED self-sovereign connection (this device already scanned an
//     origin and was accepted) — re-enter directly, even on a bare reload.
//  2. A fresh/in-flight connect intent (`?connect=<origin DID>&relay=<mediator>`,
//     no persona) — the self-sovereign path: generate browser keys, ask a name,
//     CONNECT over the mediator relay, enter on the origin's ACK (Task 5).
//  3. A persona-named live join URL (alpha launcher's per-friend links) — drop
//     straight into the app AS that daemon-held persona.
//  4. Anything else (a bare, no-persona URL) — full onboarding, where a brand-
//     new profile is born.
if (hasEstablishedConnection()) {
  enterEstablishedConnection();
} else if (runtimeConfig.connect && runtimeConfig.relay) {
  void runConnectFlow({
    connect: runtimeConfig.connect,
    relay: runtimeConfig.relay,
    deps: { loadOrCreateIdentity, createRelayClient },
  });
} else if (runtimeConfig.personaKey && runtimeConfig.mode === "live") {
  autoEnterAsPersona(runtimeConfig.personaKey, runtimeConfig.agentUrl);
} else {
  onb("welcome");
}

/**
 * Enter directly as the daemon-held persona: read its display name from the
 * agent and skip onboarding. Falls back to the capitalized persona key, and to
 * full onboarding if the agent can't be reached.
 * @param {string} key
 * @param {string} agentUrl
 */
async function autoEnterAsPersona(key, agentUrl) {
  const capitalized = key.charAt(0).toUpperCase() + key.slice(1);
  try {
    const res = await fetch(agentUrl.replace(/\/$/, "") + "/api/state", { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    state.name = (data && data.persona && data.persona.name) || capitalized;
    finishOnb();
  } catch {
    // Agent unreachable — let the human onboard manually rather than hang.
    onb("welcome");
  }
}
