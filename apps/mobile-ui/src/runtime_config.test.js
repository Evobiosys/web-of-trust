// @ts-check
import { beforeEach, describe, expect, it, vi } from "vitest";

/** @param {string} search */
function setLocation(search) {
  window.history.pushState({}, "", `/${search}`);
}

function clearStorage() {
  try {
    window.localStorage.clear();
  } catch {
    // Some environments (this repo's Node 26 test runner, notably) don't
    // expose a working localStorage — the module reset below (fresh
    // in-memory fallback per test) covers that case.
  }
}

/** Every test needs a fresh module instance: runtime_config.js keeps a
 * module-scoped in-memory fallback store for environments where
 * `window.localStorage` throws/is unavailable, and that fallback must not
 * leak state between test cases. */
async function loadGetRuntimeConfig() {
  vi.resetModules();
  const mod = await import("./runtime_config.js");
  return mod.getRuntimeConfig;
}

describe("getRuntimeConfig", () => {
  beforeEach(() => {
    clearStorage();
    setLocation("");
  });

  it("falls back to hard defaults when nothing else is set", async () => {
    const getRuntimeConfig = await loadGetRuntimeConfig();
    const config = getRuntimeConfig();
    expect(config.agentUrl).toBe("http://localhost:4101");
    expect(config.appId).toBe("housing");
    expect(config.personaKey).toBe("anna");
  });

  it("localStorage (persisted from an earlier query load) overrides defaults", async () => {
    const getRuntimeConfig = await loadGetRuntimeConfig();

    // First load: query params seed localStorage.
    setLocation("?agent=http://storage-agent:8888&app=business&persona=timo");
    getRuntimeConfig();

    // Second load: no query params — localStorage should win over hard defaults.
    setLocation("");
    const config = getRuntimeConfig();
    expect(config.agentUrl).toBe("http://storage-agent:8888");
    expect(config.appId).toBe("business");
    expect(config.personaKey).toBe("timo");
  });

  it("URL query params win over localStorage", async () => {
    const getRuntimeConfig = await loadGetRuntimeConfig();

    // Seed localStorage with one set of values via an earlier query load.
    setLocation("?agent=http://storage-agent:8888&app=business&persona=ben");
    getRuntimeConfig();

    // Now navigate with fresh query params — these must win.
    setLocation("?agent=http://query-agent:7777&app=housing&persona=timo");
    const config = getRuntimeConfig();
    expect(config.agentUrl).toBe("http://query-agent:7777");
    expect(config.appId).toBe("housing");
    expect(config.personaKey).toBe("timo");
  });

  it("persists query values into localStorage so they survive a later load with no query", async () => {
    const getRuntimeConfig = await loadGetRuntimeConfig();

    setLocation("?agent=http://query-agent:7777&app=family&persona=timo");
    getRuntimeConfig();

    setLocation(""); // simulate a later navigation with no query params
    const config = getRuntimeConfig();
    expect(config.agentUrl).toBe("http://query-agent:7777");
    expect(config.appId).toBe("family");
    expect(config.personaKey).toBe("timo");
  });

  it("only persists the query params that were actually present", async () => {
    const getRuntimeConfig = await loadGetRuntimeConfig();

    setLocation("?agent=http://query-agent:7777"); // app/persona absent
    getRuntimeConfig();

    setLocation("");
    const config = getRuntimeConfig();
    expect(config.agentUrl).toBe("http://query-agent:7777"); // from storage
    expect(config.appId).toBe("housing"); // default, nothing stored
    expect(config.personaKey).toBe("anna"); // default, nothing stored
  });
});
