import { beforeEach, describe, expect, it, vi } from "vitest";
import type { getRuntimeConfig as GetRuntimeConfig } from "./runtime_config";

function setLocation(search: string) {
  window.history.pushState({}, "", `/${search}`);
}

function clearStorage() {
  try {
    window.localStorage.clear();
  } catch {
    // Some environments (notably this repo's Node 26 test runner, where
    // Node's experimental global `localStorage` shadows jsdom's without a
    // backing file) don't expose a working localStorage at all. The module
    // reset below (fresh in-memory fallback per test) covers that case.
  }
}

/** Every test needs a fresh module instance: runtime_config.ts keeps a
 * module-scoped in-memory fallback store for environments where
 * `window.localStorage` throws/is unavailable, and that fallback must not
 * leak state between test cases. */
async function loadGetRuntimeConfig(): Promise<typeof GetRuntimeConfig> {
  vi.resetModules();
  const mod = await import("./runtime_config");
  return mod.getRuntimeConfig;
}

describe("getRuntimeConfig", () => {
  beforeEach(() => {
    clearStorage();
    setLocation("");
    vi.unstubAllEnvs();
  });

  it("falls back to hard defaults when nothing else is set", async () => {
    const getRuntimeConfig = await loadGetRuntimeConfig();
    const config = getRuntimeConfig();
    expect(config.agentUrl).toBe("http://localhost:4101");
    expect(config.profile.id).toBe("ecstatic");
    expect(config.personaKey).toBe("anna");
  });

  it("reads VITE_AGENT_URL / VITE_PERSONA env vars when set and nothing more specific exists", async () => {
    vi.stubEnv("VITE_AGENT_URL", "http://env-agent:9999");
    vi.stubEnv("VITE_PERSONA", "ben");
    const getRuntimeConfig = await loadGetRuntimeConfig();
    const config = getRuntimeConfig();
    expect(config.agentUrl).toBe("http://env-agent:9999");
    expect(config.personaKey).toBe("ben");
    expect(config.profile.id).toBe("ecstatic"); // no app env fallback per brief
  });

  it("localStorage (persisted from an earlier query load) overrides env", async () => {
    const getRuntimeConfig = await loadGetRuntimeConfig();

    // First load: query params seed localStorage.
    setLocation("?agent=http://storage-agent:8888&persona=timo");
    getRuntimeConfig();

    // Second load: no query params, but env is also set — localStorage should win.
    setLocation("");
    vi.stubEnv("VITE_AGENT_URL", "http://env-agent:9999");
    vi.stubEnv("VITE_PERSONA", "ben");

    const config = getRuntimeConfig();
    expect(config.agentUrl).toBe("http://storage-agent:8888");
    expect(config.personaKey).toBe("timo");
  });

  it("URL query params win over localStorage and env", async () => {
    const getRuntimeConfig = await loadGetRuntimeConfig();

    // Seed localStorage with one set of values via an earlier query load.
    setLocation("?agent=http://storage-agent:8888&app=business&persona=ben");
    getRuntimeConfig();

    vi.stubEnv("VITE_AGENT_URL", "http://env-agent:9999");
    vi.stubEnv("VITE_PERSONA", "anna");

    // Now navigate with fresh query params — these must win over both.
    setLocation("?agent=http://query-agent:7777&app=housing&persona=timo");
    const config = getRuntimeConfig();
    expect(config.agentUrl).toBe("http://query-agent:7777");
    expect(config.profile.id).toBe("housing");
    expect(config.personaKey).toBe("timo");
  });

  it("persists query values into localStorage so they survive a later load with no query", async () => {
    const getRuntimeConfig = await loadGetRuntimeConfig();

    setLocation("?agent=http://query-agent:7777&app=family&persona=timo");
    getRuntimeConfig();

    setLocation(""); // simulate a later navigation with no query params
    const config = getRuntimeConfig();
    expect(config.agentUrl).toBe("http://query-agent:7777");
    expect(config.profile.id).toBe("family");
    expect(config.personaKey).toBe("timo");
  });

  it("only persists the query params that were actually present", async () => {
    const getRuntimeConfig = await loadGetRuntimeConfig();

    setLocation("?agent=http://query-agent:7777"); // app/persona absent
    getRuntimeConfig();

    setLocation("");
    vi.stubEnv("VITE_PERSONA", "ben");
    const config = getRuntimeConfig();
    expect(config.agentUrl).toBe("http://query-agent:7777"); // from storage
    expect(config.profile.id).toBe("ecstatic"); // default, nothing stored
    expect(config.personaKey).toBe("ben"); // env fallback, nothing stored
  });

  it("unknown app query param resolves to the ecstatic profile fallback", async () => {
    setLocation("?app=not-a-real-profile");
    const getRuntimeConfig = await loadGetRuntimeConfig();
    const config = getRuntimeConfig();
    expect(config.profile.id).toBe("ecstatic");
  });
});
