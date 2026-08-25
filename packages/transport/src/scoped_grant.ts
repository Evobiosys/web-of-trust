// SCOPED GRANT CREDENTIAL — Task (2026-08-24, credential-provider seam): the
// north-star shape "person X has editor rights on layer Y, granted by Z on
// this date." TYPE + issue/verify path ONLY — no revocation wiring beyond
// what credential_provider.ts's generic CredentialProvider gives it for
// free, no UI. Same signing convention as vrc.ts's VRC (Ed25519Signature2020-
// shaped proof over key-sorted canonical JSON, reusing vrc.ts's exported
// `canonicalize`/`VC_CONTEXT` byte-for-byte) — see vrc.ts's header for the
// honest-labeling caveat this shape inherits unchanged: NOT URDNA2015, NOT a
// conformant VC processor, self-asserted (no witness).
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Identity } from "./did_identity.js";
import { resolveDidPeer } from "./did_identity.js";
import { canonicalize, VC_CONTEXT, type VrcProof } from "./vrc.js";

export interface ScopedGrantCredentialSubject {
  id: string; // grantee DID
  right: string; // e.g. "editor", "viewer"
  scope: string; // the layer/resource this right applies to, e.g. "layer:evobiosys-map"
}

export interface ScopedGrantCredential {
  "@context": string[];
  type: ["VerifiableCredential", "ScopedGrantCredential"];
  issuer: string; // grantor DID
  issuanceDate: string; // grantedAt
  credentialSubject: ScopedGrantCredentialSubject;
  proof: VrcProof;
}

export interface IssueScopedGrantArgs {
  grantee: string; // DID
  right: string;
  scope: string;
  /** grantedAt override (tests); defaults to now. */
  grantedAt?: string;
}

/** The signable payload: the credential without its `proof` — same canonicalize-then-encode
 * convention as vrc.ts's private `signingBytes`, reusing the exported `canonicalize` directly
 * rather than duplicating a second canonicalizer. */
function signingBytes(credentialWithoutProof: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonicalize(credentialWithoutProof)));
}

/** Issues a signed scoped-grant credential from `grantor` about `grantee`. */
export function issueScopedGrant(grantor: Identity, args: IssueScopedGrantArgs): ScopedGrantCredential {
  const credentialSubject: ScopedGrantCredentialSubject = { id: args.grantee, right: args.right, scope: args.scope };

  const unsigned: Omit<ScopedGrantCredential, "proof"> = {
    "@context": VC_CONTEXT,
    type: ["VerifiableCredential", "ScopedGrantCredential"],
    issuer: grantor.did,
    issuanceDate: args.grantedAt ?? new Date().toISOString(),
    credentialSubject,
  };

  const sig = ed25519.sign(signingBytes(unsigned), grantor.signing.secretKey);
  const proof: VrcProof = {
    type: "Ed25519Signature2020",
    created: unsigned.issuanceDate,
    verificationMethod: grantor.did,
    proofPurpose: "assertionMethod",
    jws: Buffer.from(sig).toString("base64url"),
  };
  return { ...unsigned, proof };
}

export interface ScopedGrantVerifyResult {
  valid: boolean;
  issuer?: string;
  subject?: string;
  reason?: string;
}

/** Verifies a scoped-grant credential — same recover-key-from-did:peer:2-then-check-signature
 * shape as vrc.ts's `verifyVrc`. Self-asserted (alpha): `valid: true` means "this grantor really
 * signed this," not "a witness attests the grant." */
export function verifyScopedGrant(cred: ScopedGrantCredential): ScopedGrantVerifyResult {
  try {
    const { proof, ...unsigned } = cred;
    if (proof?.type !== "Ed25519Signature2020" || typeof proof.jws !== "string") {
      return { valid: false, reason: "unsupported or missing proof" };
    }
    if (proof.verificationMethod !== cred.issuer) {
      return { valid: false, reason: "proof verificationMethod does not match issuer" };
    }
    const issuerDoc = resolveDidPeer(cred.issuer);
    const sig = new Uint8Array(Buffer.from(proof.jws, "base64url"));
    const ok = ed25519.verify(sig, signingBytes(unsigned), issuerDoc.signingPublicKey);
    if (!ok) return { valid: false, reason: "signature verification failed" };
    return { valid: true, issuer: cred.issuer, subject: cred.credentialSubject.id };
  } catch (err) {
    return { valid: false, reason: (err as Error).message };
  }
}
