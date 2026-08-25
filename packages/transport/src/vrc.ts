// VRC — Verifiable Relationship Credential (W3C-VC-SHAPED).
//
// On trust-edge creation each side issues an Ed25519-signed credential that
// asserts a relationship to a peer DID. Verification recovers the issuer's
// key from its did:peer:2 and checks the signature over the canonical,
// proof-stripped credential.
//
// HONEST LABELING (I7, README/PRIVACY): alpha VRCs are SELF-ASSERTED PAIRWISE.
// There is NO witness, no revocation, no status list, no keyring-wallet /
// OpenVTC witness (that is future work). The proof is "Ed25519Signature2020"-
// SHAPED — a detached-JWS-style base64url signature over the canonicalized
// credential — but it is NOT a full Data-Integrity / JSON-LD-canonicalization
// (URDNA2015) implementation, so it will not verify in a conformant VC
// processor. We canonicalize by deterministic key-sorted JSON, not RDF.
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Identity } from "./did_identity.js";
import { resolveDidPeer } from "./did_identity.js";

export interface VrcProof {
  type: "Ed25519Signature2020";
  created: string;
  /** verificationMethod is the issuer DID (the V-key inside it is used). */
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  /** base64url Ed25519 signature over the canonicalized, proof-stripped credential. */
  jws: string;
}

export interface VrcCredentialSubject {
  id: string; // peer DID
  relationship: string; // e.g. "trusted"
  met_context?: string;
}

export interface VerifiableRelationshipCredential {
  "@context": string[];
  type: ["VerifiableCredential", "RelationshipCredential"];
  issuer: string; // issuer DID
  issuanceDate: string;
  credentialSubject: VrcCredentialSubject;
  proof: VrcProof;
}

export interface IssueVrcArgs {
  peerDid: string;
  relationship: string;
  metContext?: string;
  /** issuanceDate override (tests); defaults to now. */
  issuedAt?: string;
}

/** Exported so other credential shapes (scoped-grant credentials, credential_provider.ts's
 * credential-id derivation) reuse the exact same VC context, not a hand-copied duplicate. */
export const VC_CONTEXT = ["https://www.w3.org/2018/credentials/v1", "https://w3id.org/security/suites/ed25519-2020/v1"];

/** Deterministic key-sorted JSON — the canonical bytes the proof signs over (NOT URDNA2015; see
 * header). Exported so scoped_grant.ts's issue/verify pair (same Ed25519Signature2020-shaped
 * proof convention) doesn't hand-roll a second, possibly-drifting canonicalizer. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** The signable payload: any credential-shaped object without its `proof` field. Widened from
 * `Omit<VerifiableRelationshipCredential, "proof">` (its original, narrower type) to `unknown` —
 * a pure widening, no behavior change for the existing VRC callers below — so this file's own
 * shape is no longer artificially VRC-specific even though the function itself stays private;
 * scoped_grant.ts reuses the exported `canonicalize` directly for its own one-line equivalent
 * rather than reaching into this module's private helper. */
function signingBytes(credentialWithoutProof: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonicalize(credentialWithoutProof)));
}

/** Issues a signed VRC from `issuer` about `peerDid`. */
export function issueVrc(issuer: Identity, args: IssueVrcArgs): VerifiableRelationshipCredential {
  const credentialSubject: VrcCredentialSubject = { id: args.peerDid, relationship: args.relationship };
  if (args.metContext !== undefined) credentialSubject.met_context = args.metContext;

  const unsigned: Omit<VerifiableRelationshipCredential, "proof"> = {
    "@context": VC_CONTEXT,
    type: ["VerifiableCredential", "RelationshipCredential"],
    issuer: issuer.did,
    issuanceDate: args.issuedAt ?? new Date().toISOString(),
    credentialSubject,
  };

  const sig = ed25519.sign(signingBytes(unsigned), issuer.signing.secretKey);
  const proof: VrcProof = {
    type: "Ed25519Signature2020",
    created: unsigned.issuanceDate,
    verificationMethod: issuer.did,
    proofPurpose: "assertionMethod",
    jws: Buffer.from(sig).toString("base64url"),
  };
  return { ...unsigned, proof };
}

export interface VrcVerifyResult {
  valid: boolean;
  issuer?: string;
  subject?: string;
  reason?: string;
}

/**
 * Verifies a VRC: recovers the issuer's Ed25519 key from its did:peer:2 and
 * checks the signature over the proof-stripped, canonicalized credential.
 * Also binds the proof's verificationMethod to the stated issuer. Alpha:
 * self-asserted, so a `valid: true` means "this issuer really signed this",
 * NOT "a witness attests the relationship".
 */
export function verifyVrc(vrc: VerifiableRelationshipCredential): VrcVerifyResult {
  try {
    const { proof, ...unsigned } = vrc;
    if (proof?.type !== "Ed25519Signature2020" || typeof proof.jws !== "string") {
      return { valid: false, reason: "unsupported or missing proof" };
    }
    // The signing key must be the issuer's own DID (no delegation in alpha).
    if (proof.verificationMethod !== vrc.issuer) {
      return { valid: false, reason: "proof verificationMethod does not match issuer" };
    }
    const issuerDoc = resolveDidPeer(vrc.issuer);
    const sig = new Uint8Array(Buffer.from(proof.jws, "base64url"));
    const ok = ed25519.verify(sig, signingBytes(unsigned), issuerDoc.signingPublicKey);
    if (!ok) return { valid: false, reason: "signature verification failed" };
    return { valid: true, issuer: vrc.issuer, subject: vrc.credentialSubject.id };
  } catch (err) {
    return { valid: false, reason: (err as Error).message };
  }
}
