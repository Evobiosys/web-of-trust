// Sign-then-encrypt message packing — the crypto core of the DIDComm-shaped
// transport. Every property that authenticity/confidentiality rests on is
// asserted here in isolation from HTTP: round-trip, tamper-rejection,
// from-binding (signing key must match the claimed sender), and
// recipient-confidentiality (a third party cannot decrypt).
import { describe, it, expect } from "vitest";
import { createIdentity } from "./did_identity.js";
import { packMessage, unpackMessage, type JwmMessage } from "./didcomm_crypto.js";

const EP = (p: number) => `http://127.0.0.1:${p}/didcomm`;

function makeMessage(from: string, to: string): JwmMessage {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    type: "https://didcomm.org/resource-web/2.0/envelope",
    from,
    to: [to],
    created_time: Date.now(),
    body: { hello: "world", n: 42 },
  };
}

describe("packMessage / unpackMessage", () => {
  it("round-trips: recipient recovers the exact message and the authenticated sender DID", () => {
    const alice = createIdentity(EP(1));
    const bob = createIdentity(EP(2));
    const msg = makeMessage(alice.did, bob.did);

    const wire = packMessage({ sender: alice, recipientDid: bob.did, message: msg });
    const { from, message } = unpackMessage({ recipient: bob, wire });

    expect(from).toBe(alice.did);
    expect(message).toEqual(msg);
  });

  it("does not expose the sender DID in the outer (cleartext) wire — sender-authenticity is confidential", () => {
    const alice = createIdentity(EP(1));
    const bob = createIdentity(EP(2));
    const wire = packMessage({ sender: alice, recipientDid: bob.did, message: makeMessage(alice.did, bob.did) });
    expect(wire.includes(alice.did)).toBe(false);
  });

  it("produces a fresh nonce + ephemeral key every call (no reuse)", () => {
    const alice = createIdentity(EP(1));
    const bob = createIdentity(EP(2));
    const msg = makeMessage(alice.did, bob.did);
    const w1 = JSON.parse(packMessage({ sender: alice, recipientDid: bob.did, message: msg }));
    const w2 = JSON.parse(packMessage({ sender: alice, recipientDid: bob.did, message: msg }));
    expect(w1.nonce).not.toBe(w2.nonce);
    expect(w1.epk).not.toBe(w2.epk);
    expect(w1.ciphertext).not.toBe(w2.ciphertext);
  });

  it("rejects a tampered ciphertext (AEAD auth failure)", () => {
    const alice = createIdentity(EP(1));
    const bob = createIdentity(EP(2));
    const wire = JSON.parse(packMessage({ sender: alice, recipientDid: bob.did, message: makeMessage(alice.did, bob.did) }));
    const ctBytes = Buffer.from(wire.ciphertext, "base64url");
    ctBytes[0] ^= 0xff;
    wire.ciphertext = ctBytes.toString("base64url");
    expect(() => unpackMessage({ recipient: bob, wire: JSON.stringify(wire) })).toThrow();
  });

  it("rejects a forged sender: attacker cannot re-label the message as coming from someone else's DID", () => {
    const alice = createIdentity(EP(1));
    const bob = createIdentity(EP(2));
    const mallory = createIdentity(EP(3));
    // Mallory signs a message but claims from = alice.did in the signed body.
    const forged: JwmMessage = { ...makeMessage(alice.did, bob.did) };
    const wire = packMessage({ sender: mallory, recipientDid: bob.did, message: forged });
    // Signature is Mallory's key, but the container's `from` is Mallory's DID
    // (packMessage stamps the true sender). The signed body says alice.did →
    // from-binding mismatch → rejected.
    expect(() => unpackMessage({ recipient: bob, wire })).toThrow(/from|sender|binding/i);
  });

  it("cannot be decrypted by an unintended recipient", () => {
    const alice = createIdentity(EP(1));
    const bob = createIdentity(EP(2));
    const eve = createIdentity(EP(3));
    const wire = packMessage({ sender: alice, recipientDid: bob.did, message: makeMessage(alice.did, bob.did) });
    expect(() => unpackMessage({ recipient: eve, wire })).toThrow();
  });
});
