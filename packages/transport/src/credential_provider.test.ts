// CredentialProvider — LocalVrcProvider (issue -> persist -> verify ->
// revoke -> verify-fails), presentation nonce, scoped-grant issue path, and
// OpenVtcProvider's stub-throws-NotImplementedError contract.
import { describe, it, expect } from "vitest";
import { createIdentity } from "./did_identity.js";
import { LocalVrcProvider, InMemoryCredentialStore, OpenVtcProvider, NotImplementedError, credentialId } from "./credential_provider.js";
import type { VerifiableRelationshipCredential } from "./vrc.js";

describe("LocalVrcProvider — relationship credentials", () => {
  it("issue -> persist -> verify -> revoke -> verify-fails", async () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const peer = createIdentity("http://127.0.0.1:2/didcomm");
    const provider = new LocalVrcProvider(issuer);

    const record = await provider.issue({ kind: "relationship", peerDid: peer.did, relationship: "trusted" });
    expect(record.kind).toBe("relationship");
    expect(record.id).toBe(credentialId(record.credential));
    expect(record.revoked_at).toBeUndefined();

    // Persisted: shows up in list().
    const listed = await provider.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(record.id);

    // Verifies while live.
    const verified = await provider.verify(record.credential);
    expect(verified).toEqual({ valid: true, issuer: issuer.did, subject: peer.did });

    // Revoke, then the SAME credential fails verification (revoked, not just re-signed-away).
    await provider.revoke(record.id);
    const afterRevoke = await provider.verify(record.credential);
    expect(afterRevoke.valid).toBe(false);
    expect(afterRevoke.revoked).toBe(true);
    expect(afterRevoke.issuer).toBe(issuer.did); // signature info still surfaces even though revoked

    // The store record itself carries revoked_at now.
    const [revokedRecord] = await provider.list();
    expect(revokedRecord?.revoked_at).toBeDefined();
  });

  it("issue is idempotent per (issuer, subject, relationship) — no duplicate rows on repeated export", async () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const peer = createIdentity("http://127.0.0.1:2/didcomm");
    const provider = new LocalVrcProvider(issuer);

    const first = await provider.issue({ kind: "relationship", peerDid: peer.did, relationship: "trusted" });
    const second = await provider.issue({ kind: "relationship", peerDid: peer.did, relationship: "trusted" });
    expect(second.id).toBe(first.id);
    expect(await provider.list()).toHaveLength(1);

    // A different relationship label for the SAME peer is a distinct credential.
    const different = await provider.issue({ kind: "relationship", peerDid: peer.did, relationship: "close" });
    expect(different.id).not.toBe(first.id);
    expect(await provider.list()).toHaveLength(2);
  });

  it("re-issues after revoke, later in time (revocation does not permanently block re-issuing)", async () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const peer = createIdentity("http://127.0.0.1:2/didcomm");
    const provider = new LocalVrcProvider(issuer);

    // Distinct `issuedAt` values (vrc.ts's IssueVrcArgs) simulate real time
    // passing between the two issue() calls — otherwise, issued within the
    // same clock-resolution tick, the second call's signed content would be
    // byte-identical to the first (same issuer+subject+relationship+
    // issuanceDate), and therefore derive the SAME id; see the next test
    // for that degenerate, still-correct case.
    const first = await provider.issue({ kind: "relationship", peerDid: peer.did, relationship: "trusted", issuedAt: "2026-01-01T00:00:00.000Z" });
    await provider.revoke(first.id);
    const second = await provider.issue({ kind: "relationship", peerDid: peer.did, relationship: "trusted", issuedAt: "2026-01-01T00:05:00.000Z" });
    expect(second.id).not.toBe(first.id);
    expect(await provider.list()).toHaveLength(2);
    expect((await provider.list()).find((r) => r.id === second.id)?.revoked_at).toBeUndefined();
  });

  it("revocation is sticky under id collision: re-issuing byte-identical content (same clock tick) does not resurrect the revoked id", async () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const peer = createIdentity("http://127.0.0.1:2/didcomm");
    const provider = new LocalVrcProvider(issuer);

    const fixedIssuedAt = "2026-01-01T00:00:00.000Z";
    const first = await provider.issue({ kind: "relationship", peerDid: peer.did, relationship: "trusted", issuedAt: fixedIssuedAt });
    await provider.revoke(first.id);
    // Same issuer, subject, relationship, AND issuanceDate -> byte-identical
    // credential -> same derived id as `first`.
    const second = await provider.issue({ kind: "relationship", peerDid: peer.did, relationship: "trusted", issuedAt: fixedIssuedAt });
    expect(second.id).toBe(first.id);
    expect(second.revoked_at).toBeDefined(); // NOT silently un-revoked by the overwrite
    expect(await provider.list()).toHaveLength(1);
  });

  it("verify rejects a tampered credential the same way vrc.ts's verifyVrc does (signature check happens before the revocation check)", async () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const peer = createIdentity("http://127.0.0.1:2/didcomm");
    const provider = new LocalVrcProvider(issuer);
    const record = await provider.issue({ kind: "relationship", peerDid: peer.did, relationship: "trusted" });
    const forged: VerifiableRelationshipCredential = {
      ...(record.credential as VerifiableRelationshipCredential),
      credentialSubject: { ...(record.credential as VerifiableRelationshipCredential).credentialSubject, relationship: "family" },
    };
    const result = await provider.verify(forged);
    expect(result.valid).toBe(false);
    expect(result.revoked).toBeUndefined();
  });
});

describe("LocalVrcProvider — scoped-grant credentials", () => {
  it("issues a scoped-grant credential (grantee/right/scope/grantor/grantedAt north star)", async () => {
    const grantor = createIdentity("http://127.0.0.1:1/didcomm");
    const grantee = createIdentity("http://127.0.0.1:2/didcomm");
    const provider = new LocalVrcProvider(grantor);

    const record = await provider.issue({ kind: "scoped_grant", grantee: grantee.did, right: "editor", scope: "layer:evobiosys-map" });
    expect(record.kind).toBe("scoped_grant");
    const cred = record.credential as import("./scoped_grant.js").ScopedGrantCredential;
    expect(cred.type).toEqual(["VerifiableCredential", "ScopedGrantCredential"]);
    expect(cred.issuer).toBe(grantor.did);
    expect(cred.credentialSubject).toEqual({ id: grantee.did, right: "editor", scope: "layer:evobiosys-map" });

    const verified = await provider.verify(record.credential);
    expect(verified).toEqual({ valid: true, issuer: grantor.did, subject: grantee.did });
  });
});

describe("LocalVrcProvider — present()", () => {
  it("builds a VerifiablePresentation with a nonce/audience, defaulting to a fresh nonce per call", async () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const peer = createIdentity("http://127.0.0.1:2/didcomm");
    const provider = new LocalVrcProvider(issuer);
    const record = await provider.issue({ kind: "relationship", peerDid: peer.did, relationship: "trusted" });

    const vp = await provider.present({ ids: [record.id], audience: "https://example.org/verifier" });
    expect(vp.type).toEqual(["VerifiablePresentation"]);
    expect(vp.holder).toBe(issuer.did);
    expect(vp.verifiableCredential).toEqual([record.credential]);
    expect(vp.proof.audience).toBe("https://example.org/verifier");
    expect(typeof vp.proof.nonce).toBe("string");
    expect(vp.proof.nonce.length).toBeGreaterThan(0);

    const vp2 = await provider.present({ ids: [record.id], audience: "https://example.org/verifier" });
    expect(vp2.proof.nonce).not.toBe(vp.proof.nonce); // fresh nonce absent an explicit override

    const vp3 = await provider.present({ ids: [record.id], audience: "https://example.org/verifier", nonce: "fixed-for-test" });
    expect(vp3.proof.nonce).toBe("fixed-for-test");
  });

  it("silently drops ids that are not (or no longer) in the store", async () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const provider = new LocalVrcProvider(issuer);
    const vp = await provider.present({ ids: ["unknown-id"], audience: "https://example.org/verifier" });
    expect(vp.verifiableCredential).toEqual([]);
  });
});

describe("LocalVrcProvider — injected CredentialStore", () => {
  it("uses the injected store instead of its own default (persistence seam is real, not hardcoded)", async () => {
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");
    const peer = createIdentity("http://127.0.0.1:2/didcomm");
    const store = new InMemoryCredentialStore();
    const provider = new LocalVrcProvider(issuer, { store });

    const record = await provider.issue({ kind: "relationship", peerDid: peer.did, relationship: "trusted" });
    expect(store.get(record.id)).toBeDefined();
    expect(store.list()).toHaveLength(1);
  });
});

describe("OpenVtcProvider — stub", () => {
  it("every method throws NotImplementedError, proving the swap seam without a network integration", async () => {
    const provider = new OpenVtcProvider({ vtaUrl: "https://vta.openvtc.danubetech.com:8100" });
    const issuer = createIdentity("http://127.0.0.1:1/didcomm");

    await expect(provider.issue({ kind: "relationship", peerDid: issuer.did, relationship: "trusted" })).rejects.toBeInstanceOf(NotImplementedError);
    await expect(provider.verify({} as never)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(provider.revoke("some-id")).rejects.toBeInstanceOf(NotImplementedError);
    await expect(provider.present({ ids: [], audience: "x" })).rejects.toBeInstanceOf(NotImplementedError);
    await expect(provider.list()).rejects.toBeInstanceOf(NotImplementedError);
  });
});
