// did:peer:2 identity — creation, deterministic (de)serialization, and local
// (no-network) resolution of inline keys. Crypto correctness is load-bearing
// here, so every assertion is against re-derived key material, never a stored
// copy of it.
import { describe, it, expect } from "vitest";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import {
  createIdentity,
  serializeIdentity,
  deserializeIdentity,
  resolveDidPeer,
  getCardPayload,
} from "./did_identity.js";

const ENDPOINT = "http://127.0.0.1:8091/didcomm";

describe("createIdentity", () => {
  it("mints a did:peer:2 with one Ed25519 verification key + one X25519 key-agreement key + a service endpoint", () => {
    const id = createIdentity(ENDPOINT);
    expect(id.did.startsWith("did:peer:2")).toBe(true);
    expect(id.serviceEndpoint).toBe(ENDPOINT);
    // secret keys are 32 bytes; public keys derive from them.
    expect(id.signing.secretKey).toHaveLength(32);
    expect(id.keyAgreement.secretKey).toHaveLength(32);
    expect(id.signing.publicKey).toEqual(ed25519.getPublicKey(id.signing.secretKey));
    expect(id.keyAgreement.publicKey).toEqual(x25519.getPublicKey(id.keyAgreement.secretKey));
  });

  it("is unique per call (fresh randomness)", () => {
    expect(createIdentity(ENDPOINT).did).not.toBe(createIdentity(ENDPOINT).did);
  });
});

describe("resolveDidPeer (local, no network)", () => {
  it("recovers the exact public keys and endpoint encoded in the DID", () => {
    const id = createIdentity(ENDPOINT);
    const doc = resolveDidPeer(id.did);
    expect(doc.signingPublicKey).toEqual(id.signing.publicKey);
    expect(doc.keyAgreementPublicKey).toEqual(id.keyAgreement.publicKey);
    expect(doc.serviceEndpoint).toBe(ENDPOINT);
  });

  it("rejects a non-did:peer:2 string", () => {
    expect(() => resolveDidPeer("did:example:123")).toThrow();
  });
});

describe("serialize/deserialize identity (disk round-trip)", () => {
  it("round-trips all key material and the DID deterministically", () => {
    const id = createIdentity(ENDPOINT);
    const json = serializeIdentity(id);
    // deterministic: same identity serializes byte-identically every time.
    expect(serializeIdentity(id)).toBe(json);
    const back = deserializeIdentity(json);
    expect(back.did).toBe(id.did);
    expect(back.signing.secretKey).toEqual(id.signing.secretKey);
    expect(back.keyAgreement.secretKey).toEqual(id.keyAgreement.secretKey);
    expect(back.serviceEndpoint).toBe(id.serviceEndpoint);
    // resolving the restored identity's DID yields its own keys.
    expect(resolveDidPeer(back.did).signingPublicKey).toEqual(back.signing.publicKey);
  });
});

describe("getCardPayload", () => {
  it("exposes did + endpoint + display for the meet-card (Task 5 /api/card wiring at integration)", () => {
    const id = createIdentity(ENDPOINT);
    expect(getCardPayload(id, "Anna")).toEqual({ display: "Anna", did: id.did, endpoint: ENDPOINT });
  });
});
