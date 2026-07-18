import { getProfile } from "./profiles";
import type { AppProfile } from "./profiles";

/** localStorage keys the resolved runtime config is persisted under, so a
 * value delivered via URL query param on one load (e.g. a QR-code deep
 * link) survives subsequent loads that carry no query string. */
const STORAGE_KEYS = {
  agentUrl: "resource-web.runtime_config.agentUrl",
  profileId: "resource-web.runtime_config.profileId",
  personaKey: "resource-web.runtime_config.personaKey",
} as const;

const DEFAULTS = {
  agentUrl: "http://localhost:4101",
  profileId: "ecstatic",
  personaKey: "anna",
} as const;

// Some environments expose `window.localStorage` but throw (or return
// undefined) on access — Safari private-browsing mode, storage disabled by
// policy, or (in this repo's test environment) Node's experimental global
// `localStorage` shadowing jsdom's without a backing file. In all of those
// cases we degrade to a module-lifetime in-memory store rather than crash:
// query params still work every load; only cross-load persistence is lost.
let memoryFallback: Map<string, string> | undefined;

function getFallbackStore(): Map<string, string> {
  if (!memoryFallback) memoryFallback = new Map();
  return memoryFallback;
}

function readStorage(key: string): string | undefined {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? undefined : value;
  } catch {
    return getFallbackStore().get(key);
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    getFallbackStore().set(key, value);
  }
}

export interface RuntimeConfig {
  agentUrl: string;
  profile: AppProfile;
  personaKey: string;
}

/**
 * Resolves device-ui's runtime configuration.
 *
 * Precedence (highest first): URL query params (`?agent=…&app=…&persona=…`)
 * > localStorage > `VITE_AGENT_URL` / `VITE_PERSONA` env > hard defaults
 * (`http://localhost:4101`, `ecstatic`, `anna`).
 *
 * Any query param present on this load is persisted to localStorage so it
 * survives later loads that carry no query string (e.g. after a QR-code
 * onboarding link is opened once). There is no env fallback for the app
 * profile id (only agent URL and persona have `VITE_*` env vars).
 */
export function getRuntimeConfig(): RuntimeConfig {
  const params = new URLSearchParams(window.location.search);
  const queryAgent = params.get("agent") ?? undefined;
  const queryApp = params.get("app") ?? undefined;
  const queryPersona = params.get("persona") ?? undefined;

  if (queryAgent) writeStorage(STORAGE_KEYS.agentUrl, queryAgent);
  if (queryApp) writeStorage(STORAGE_KEYS.profileId, queryApp);
  if (queryPersona) writeStorage(STORAGE_KEYS.personaKey, queryPersona);

  const envAgentUrl = import.meta.env.VITE_AGENT_URL as string | undefined;
  const envPersonaKey = import.meta.env.VITE_PERSONA as string | undefined;

  const agentUrl = queryAgent ?? readStorage(STORAGE_KEYS.agentUrl) ?? envAgentUrl ?? DEFAULTS.agentUrl;
  const profileId = queryApp ?? readStorage(STORAGE_KEYS.profileId) ?? DEFAULTS.profileId;
  const personaKey = queryPersona ?? readStorage(STORAGE_KEYS.personaKey) ?? envPersonaKey ?? DEFAULTS.personaKey;

  return { agentUrl, profile: getProfile(profileId), personaKey };
}
