// @ts-check
import { describe, it, expect } from "vitest";
import { buildConnectUrl } from "./connect_url.js";

describe("buildConnectUrl", () => {
  it("encodes did + relay(=endpoint) + app, with NO persona param", () => {
    const card = {
      peer_id: "did:peer:2.abc",
      display: "Anna",
      did: "did:peer:2.Ez6MkAbc",
      endpoint: "https://192.168.1.42:4101/didcomm",
    };
    const url = buildConnectUrl("http://192.168.1.42:5173", card, "ecstatic");
    const expected = new URL("http://192.168.1.42:5173");
    expected.searchParams.set("connect", card.did);
    expected.searchParams.set("relay", card.endpoint);
    expected.searchParams.set("app", "ecstatic");
    expect(url).toBe(expected.toString());
    expect(url).not.toBeNull();
    expect(String(url)).not.toContain("persona=");
  });

  it("uses the card's own didcomm endpoint as relay (no dedicated relay URL yet), even when relays[] (DIDs) is present", () => {
    const card = {
      did: "did:peer:2.Ez6MkAbc",
      endpoint: "https://192.168.1.42:4101/didcomm",
      relays: ["did:peer:2.RelayDid1"],
    };
    const url = /** @type {string} */ (buildConnectUrl("http://192.168.1.42:5173", card, "ecstatic"));
    const parsed = new URL(url);
    expect(parsed.searchParams.get("relay")).toBe(card.endpoint);
    expect(parsed.searchParams.get("connect")).toBe(card.did);
    expect(parsed.searchParams.get("app")).toBe("ecstatic");
    expect(parsed.searchParams.has("persona")).toBe(false);
  });

  it("returns null when the card has no did (mock/matrix transport — no DIDComm identity yet)", () => {
    const card = { peer_id: "@anna:wot.local", display: "Anna" };
    expect(buildConnectUrl("http://localhost:5173", card, "ecstatic")).toBeNull();
  });

  it("returns null for a null/undefined card", () => {
    expect(buildConnectUrl("http://localhost:5173", null, "ecstatic")).toBeNull();
    expect(buildConnectUrl("http://localhost:5173", undefined, "ecstatic")).toBeNull();
  });
});
