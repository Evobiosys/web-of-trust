import { describe, it, expect } from "vitest";
import { localpartOf, derivePassword } from "./matrix_provisioning.js";

describe("localpartOf", () => {
  it("extracts the localpart from a full matrix user id", () => {
    expect(localpartOf("@anna-agent:wot.local")).toBe("anna-agent");
  });

  it("throws on a malformed matrix user id", () => {
    expect(() => localpartOf("anna-agent")).toThrow();
    expect(() => localpartOf("@anna-agent")).toThrow();
    expect(() => localpartOf("")).toThrow();
  });
});

describe("derivePassword", () => {
  it("is deterministic for the same secret + localpart", () => {
    const a = derivePassword("s3cret", "anna-agent");
    const b = derivePassword("s3cret", "anna-agent");
    expect(a).toBe(b);
  });

  it("differs across localparts (same secret)", () => {
    expect(derivePassword("s3cret", "anna-agent")).not.toBe(derivePassword("s3cret", "ben-agent"));
  });

  it("differs across secrets (same localpart)", () => {
    expect(derivePassword("s3cret-a", "anna-agent")).not.toBe(derivePassword("s3cret-b", "anna-agent"));
  });

  it("produces a non-empty hex string", () => {
    expect(derivePassword("s3cret", "anna-agent")).toMatch(/^[0-9a-f]+$/);
  });
});
