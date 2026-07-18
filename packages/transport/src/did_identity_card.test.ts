// Task 8 (core-transport-plan.md): CardPayload's `relays`/`ice_servers`
// extension. A NEW file (not an edit to the existing did_identity.test.ts)
// per the scope guard — that file's existing getCardPayload test is the
// regression guard proving the mock-transport (no-opts) card is unchanged,
// and stays untouched.
import { describe, it, expect } from "vitest";
import { createIdentity, getCardPayload } from "./did_identity.js";

const ENDPOINT = "http://anna.example/didcomm";

describe("getCardPayload — Task 8 relays/ice_servers", () => {
  it("omits relays and ice_servers entirely (not just undefined) when no opts are supplied", () => {
    const id = createIdentity(ENDPOINT);
    const card = getCardPayload(id, "Anna");
    expect("relays" in card).toBe(false);
    expect("ice_servers" in card).toBe(false);
    // JSON-serialized form (what actually goes into the QR / /api/card body)
    // also carries no such keys.
    expect(JSON.parse(JSON.stringify(card))).not.toHaveProperty("relays");
    expect(JSON.parse(JSON.stringify(card))).not.toHaveProperty("ice_servers");
  });

  it("includes relays when supplied, as the relay nodes' DIDs verbatim", () => {
    const id = createIdentity(ENDPOINT);
    const relay1 = createIdentity("http://relay1.example/didcomm");
    const relay2 = createIdentity("http://relay2.example/didcomm");
    const card = getCardPayload(id, "Anna", { relays: [relay1.did, relay2.did] });
    expect(card.relays).toEqual([relay1.did, relay2.did]);
  });

  it("includes ice_servers when supplied, independently of relays", () => {
    const id = createIdentity(ENDPOINT);
    const card = getCardPayload(id, "Anna", { ice_servers: ["stun:example.org:3478"] });
    expect(card.ice_servers).toEqual(["stun:example.org:3478"]);
    expect("relays" in card).toBe(false);
  });

  it("an empty relays array is still 'supplied' — included as [], not omitted", () => {
    const id = createIdentity(ENDPOINT);
    const card = getCardPayload(id, "Anna", { relays: [] });
    expect("relays" in card).toBe(true);
    expect(card.relays).toEqual([]);
  });

  it("display/did/endpoint are unchanged from the pre-Task-8 shape when relays/ice_servers are supplied", () => {
    const id = createIdentity(ENDPOINT);
    const card = getCardPayload(id, "Anna", { relays: ["did:peer:2.Vzrelay"] });
    expect(card.display).toBe("Anna");
    expect(card.did).toBe(id.did);
    expect(card.endpoint).toBe(ENDPOINT);
  });
});
