// VRC — signed, W3C-VC-shaped relationship credentials. Alpha VRCs are
// self-asserted pairwise (no witness); the test pins issue/verify round-trip
// and every rejection path a verifier must enforce.
import { describe, it, expect } from "vitest";
import { createIdentity } from "./did_identity.js";
import { issueVrc, verifyVrc } from "./vrc.js";

describe("issueVrc / verifyVrc", () => {
  it("issues a W3C-VC-shaped RelationshipCredential and verifies it", () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const peer = createIdentity("http://127.0.0.1:2/didcomm");

    const vrc = issueVrc(issuer, { peerDid: peer.did, relationship: "trusted", metContext: "met at repair café" });

    expect(vrc.type).toEqual(["VerifiableCredential", "RelationshipCredential"]);
    expect(vrc.issuer).toBe(issuer.did);
    expect(vrc.credentialSubject.id).toBe(peer.did);
    expect(vrc.credentialSubject.relationship).toBe("trusted");
    expect(vrc.credentialSubject.met_context).toBe("met at repair café");
    expect(vrc.proof.type).toBe("Ed25519Signature2020");
    expect(typeof vrc.proof.jws).toBe("string");
    expect(vrc["@context"]).toContain("https://www.w3.org/2018/credentials/v1");

    expect(verifyVrc(vrc)).toEqual({ valid: true, issuer: issuer.did, subject: peer.did });
  });

  it("omits met_context when not provided", () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const peer = createIdentity("http://127.0.0.1:2/didcomm");
    const vrc = issueVrc(issuer, { peerDid: peer.did, relationship: "trusted" });
    expect(vrc.credentialSubject.met_context).toBeUndefined();
    expect(verifyVrc(vrc).valid).toBe(true);
  });

  it("rejects a VRC whose credentialSubject was tampered after signing", () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const peer = createIdentity("http://127.0.0.1:2/didcomm");
    const vrc = issueVrc(issuer, { peerDid: peer.did, relationship: "trusted" });
    const forged = { ...vrc, credentialSubject: { ...vrc.credentialSubject, relationship: "family" } };
    expect(verifyVrc(forged).valid).toBe(false);
  });

  it("rejects a VRC signed by a key that is not the issuer's DID (forged issuer)", () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const attacker = createIdentity("http://127.0.0.1:3/didcomm");
    const peer = createIdentity("http://127.0.0.1:2/didcomm");
    const real = issueVrc(attacker, { peerDid: peer.did, relationship: "trusted" });
    // Re-label the issuer to someone else's DID but keep the attacker's signature.
    const forged = { ...real, issuer: issuer.did };
    expect(verifyVrc(forged).valid).toBe(false);
  });

  it("both directions can issue: each side holds its own VRC about the other", () => {
    const anna = createIdentity("http://127.0.0.1:1/didcomm");
    const ben = createIdentity("http://127.0.0.1:2/didcomm");
    const annaAboutBen = issueVrc(anna, { peerDid: ben.did, relationship: "trusted" });
    const benAboutAnna = issueVrc(ben, { peerDid: anna.did, relationship: "trusted" });
    expect(verifyVrc(annaAboutBen)).toEqual({ valid: true, issuer: anna.did, subject: ben.did });
    expect(verifyVrc(benAboutAnna)).toEqual({ valid: true, issuer: ben.did, subject: anna.did });
  });
});
