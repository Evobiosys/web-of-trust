import { describe, expect, it } from "vitest";
import { getPersonaTheme } from "./persona";

describe("getPersonaTheme", () => {
  it("maps anna to a warm accent", () => {
    expect(getPersonaTheme("anna")).toEqual({ accentClass: "accent-warm", displayName: "Anna" });
  });

  it("maps ben to a cool accent", () => {
    expect(getPersonaTheme("ben")).toEqual({ accentClass: "accent-cool", displayName: "Ben" });
  });

  it("maps timo to a neutral accent", () => {
    expect(getPersonaTheme("timo")).toEqual({ accentClass: "accent-neutral", displayName: "Timo" });
  });

  it("falls back to a neutral accent with the raw key for unknown personas", () => {
    expect(getPersonaTheme("mystery")).toEqual({ accentClass: "accent-neutral", displayName: "mystery" });
  });
});
