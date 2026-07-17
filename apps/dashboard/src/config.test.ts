import { describe, expect, it } from "vitest";
import { isStepLabelMessage, parseConfig } from "./config";

describe("parseConfig", () => {
  it("falls back to default anna/ben ports and an empty step when no query is given", () => {
    const config = parseConfig("");
    expect(config).toEqual({
      annaUrl: "http://localhost:5173",
      benUrl: "http://localhost:5174",
      step: "",
    });
  });

  it("reads anna/ben/step overrides from the query string", () => {
    const config = parseConfig("?anna=http://localhost:9001&ben=http://localhost:9002&step=ben-consent-card");
    expect(config).toEqual({
      annaUrl: "http://localhost:9001",
      benUrl: "http://localhost:9002",
      step: "ben-consent-card",
    });
  });

  it("ignores unrelated query params", () => {
    const config = parseConfig("?foo=bar");
    expect(config.annaUrl).toBe("http://localhost:5173");
    expect(config.benUrl).toBe("http://localhost:5174");
  });
});

describe("isStepLabelMessage", () => {
  it("accepts a well-formed step-label message", () => {
    expect(isStepLabelMessage({ type: "step-label", text: "anna-asks" })).toBe(true);
  });

  it("rejects messages with the wrong type", () => {
    expect(isStepLabelMessage({ type: "something-else", text: "x" })).toBe(false);
  });

  it("rejects messages missing text", () => {
    expect(isStepLabelMessage({ type: "step-label" })).toBe(false);
  });

  it("rejects non-string text", () => {
    expect(isStepLabelMessage({ type: "step-label", text: 42 })).toBe(false);
  });

  it("rejects null/primitive payloads", () => {
    expect(isStepLabelMessage(null)).toBe(false);
    expect(isStepLabelMessage("step-label")).toBe(false);
    expect(isStepLabelMessage(undefined)).toBe(false);
  });
});
