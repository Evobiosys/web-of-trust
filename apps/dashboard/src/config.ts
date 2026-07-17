/**
 * Pure config/message parsing for the dashboard shell — kept separate from
 * DOM wiring (src/main.ts) so it is unit-testable without a browser.
 */

export interface DashboardConfig {
  annaUrl: string;
  benUrl: string;
  step: string;
}

const DEFAULT_ANNA_URL = "http://localhost:5173";
const DEFAULT_BEN_URL = "http://localhost:5174";

/** Reads `?anna=`, `?ben=`, `?step=` from a location.search string. */
export function parseConfig(search: string): DashboardConfig {
  const params = new URLSearchParams(search);
  return {
    annaUrl: params.get("anna") || DEFAULT_ANNA_URL,
    benUrl: params.get("ben") || DEFAULT_BEN_URL,
    step: params.get("step") || "",
  };
}

export interface StepLabelMessage {
  type: "step-label";
  text: string;
}

/** Type guard for the Playwright postMessage hook: `{type:"step-label", text}`. */
export function isStepLabelMessage(data: unknown): data is StepLabelMessage {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as Record<string, unknown>;
  return candidate.type === "step-label" && typeof candidate.text === "string";
}
