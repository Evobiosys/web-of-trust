// @ts-check
// Browser entry: styles + boot + skin + open onboarding (the golden path start).

import "./styles.css";
import { bootApp } from "./app.js";
import { onb, finishOnb } from "./screens/onboarding.js";
import { state } from "./store.js";
import { getRuntimeConfig } from "./runtime_config.js";
import { applySkin } from "./skin.js";
import { getProfile } from "@resource-web/app-profiles";

const runtimeConfig = getRuntimeConfig();
const appCtx = bootApp({ mode: runtimeConfig.mode, agentUrl: runtimeConfig.agentUrl });
applySkin(getProfile(runtimeConfig.appId));
// Live mode boots its REST/WS connection immediately; fixture's start() is a
// no-op, so this is safe in both modes. (Onboarding also calls seed(), which
// live aliases to start() — start() is idempotent.)
appCtx.api.start();

// A join URL that names a persona (the alpha launcher's per-friend links) drops
// you straight into the app AS that persona — the identity already lives in the
// agent daemon this client is pointed at, so re-typing a name in onboarding is
// friction, not sovereignty. A URL with NO persona (a fresh device scanning an
// origin's QR) still gets the full onboarding, which is where a new profile is
// born.
if (runtimeConfig.personaKey && runtimeConfig.mode === "live") {
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
