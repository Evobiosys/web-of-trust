import { describe, expect, it } from "vitest";
import { base58btc } from "multiformats/bases/base58";
import { generateIdentity, PLACEHOLDER_RELAY_ENDPOINT } from "./identity.js";

// Mirrors did_identity.ts's decode side, so a passing test is direct evidence
// the V/E/S encoding produced here is byte-compatible with the daemon's
// resolver, not just "looks like a DID".
const ED25519_PUB_PREFIX = Uint8Array.from([0xed, 0x01]);
const X25519_PUB_PREFIX = Uint8Array.from([0xec, 0x01]);
const DID_PEER_2_PREFIX = "did:peer:2";

function decodeMultibaseKey(mb: string, expectedPrefix: Uint8Array): Uint8Array {
  const bytes = base58btc.decode(mb);
  for (let i = 0; i < expectedPrefix.length; i++) {
    expect(bytes[i]).toBe(expectedPrefix[i]);
  }
  return bytes.slice(expectedPrefix.length);
}

function fromBase64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface DecodedDidPeer2 {
  signingPublicKey: Uint8Array;
  keyAgreementPublicKey: Uint8Array;
  serviceEndpoint: string;
}

function decodeDidPeer2(did: string): DecodedDidPeer2 {
  expect(did.startsWith(DID_PEER_2_PREFIX + ".")).toBe(true);
  const elements = did.slice(DID_PEER_2_PREFIX.length + 1).split(".");
  expect(elements).toHaveLength(3);

  expect(elements[0][0]).toBe("V");
  expect(elements[1][0]).toBe("E");
  expect(elements[2][0]).toBe("S");

  const signingPublicKey = decodeMultibaseKey(elements[0].slice(1), ED25519_PUB_PREFIX);
  const keyAgreementPublicKey = decodeMultibaseKey(elements[1].slice(1), X25519_PUB_PREFIX);

  const svcBytes = fromBase64url(elements[2].slice(1));
  const svc = JSON.parse(new TextDecoder().decode(svcBytes)) as { t: string; s: string; a: string[] };
  expect(svc.t).toBe("dm");
  expect(svc.a).toEqual(["didcomm/v2"]);

  return { signingPublicKey, keyAgreementPublicKey, serviceEndpoint: svc.s };
}

describe("generateIdentity", () => {
  it("produces a valid did:peer:2 DID whose V/E/S elements decode", () => {
    const identity = generateIdentity();
    const decoded = decodeDidPeer2(identity.did);

    expect(decoded.signingPublicKey).toHaveLength(32);
    expect(decoded.keyAgreementPublicKey).toHaveLength(32);
    expect(decoded.serviceEndpoint).toBe(PLACEHOLDER_RELAY_ENDPOINT);
  });

  it("derives the DID's public keys from the returned secret keys", async () => {
    const { ed25519, x25519 } = await import("@noble/curves/ed25519.js");
    const identity = generateIdentity();
    const decoded = decodeDidPeer2(identity.did);

    expect(ed25519.getPublicKey(identity.signingSecretKey)).toEqual(decoded.signingPublicKey);
    expect(x25519.getPublicKey(identity.keyAgreementSecretKey)).toEqual(decoded.keyAgreementPublicKey);
  });

  it("advertises a custom endpoint when one is supplied", () => {
    const identity = generateIdentity({ endpoint: "https://relay.example.com/inbox" });
    const decoded = decodeDidPeer2(identity.did);
    expect(decoded.serviceEndpoint).toBe("https://relay.example.com/inbox");
  });

  it("produces a different identity on every call", () => {
    const a = generateIdentity();
    const b = generateIdentity();

    expect(a.did).not.toBe(b.did);
    expect(a.signingSecretKey).not.toEqual(b.signingSecretKey);
    expect(a.keyAgreementSecretKey).not.toEqual(b.keyAgreementSecretKey);
  });
});
