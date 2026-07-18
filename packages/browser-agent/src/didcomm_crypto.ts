// Sign-then-encrypt message packing for the browser DIDComm-shaped transport.
//
// REUSE DECISION: this is a browser-safe REIMPLEMENTATION of
// packages/transport/src/didcomm_crypto.ts — not an import of that package.
// Two independent reasons, mirroring identity.ts's own REUSE DECISION:
//   1. transport's package.json depends on `ws` and `matrix-bot-sdk`
//      (node-only), and its top-level barrel re-exports everything from one
//      entry point, so importing @resource-web/transport here would pull
//      those node-only deps into the browser bundle transitively.
//   2. transport's didcomm_crypto.ts (and the did_identity.ts#resolveDidPeer
//      it calls) use Buffer-based base64url helpers — Buffer isn't
//      guaranteed in a browser bundle.
// The cryptographic ALGORITHM below is byte-for-byte identical to transport's
// (same HKDF info string, same field order, same sign-exact-payload-bytes
// discipline) so a wire packed here decrypts correctly on a Node peer running
// transport's unpackMessage, and vice versa — only the base64url plumbing and
// the Identity shape (this package's flat BrowserIdentity, not transport's
// nested {signing:{secretKey}} KeyPair shape) differ.
//
// Scheme (see transport's didcomm_crypto.ts file header for the full
// deviation-set rationale — this is DIDComm-v2-SHAPED, NOT the JWM/JWE wire
// the RFC specifies):
//   sender authenticity  : Ed25519 signature over the exact serialized inner
//                          message bytes, carried INSIDE the encrypted
//                          payload (anon-crypt outer, auth-crypt intent).
//   confidentiality      : X25519 ECDH-ES (fresh ephemeral sender key) with
//                          the recipient's static key-agreement key -> HKDF-
//                          SHA256 -> XChaCha20-Poly1305 AEAD.
//   from-binding         : on unpack we verify BOTH (a) the signature against
//                          the key resolved from the claimed sender DID, and
//                          (b) that the signed message's `from` equals that DID.
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import type { BrowserIdentity } from "./identity.js";
import { fromBase64url, resolveDidPeer, toBase64url } from "./identity.js";

/** JWM-shaped application message. `body` is the app payload (a protocol Envelope, a room message, …). */
export interface JwmMessage {
  id: string;
  type: string;
  from: string;
  to: string[];
  created_time: number;
  body: unknown;
}

/** Outer, mostly-cleartext wire object. Deliberately does NOT contain the sender DID. */
interface EncryptedWire {
  typ: "application/openvtc-encrypted+json";
  alg: "ECDH-ES+XC20P";
  /** ephemeral X25519 public key, base64url. */
  epk: string;
  /** 24-byte XChaCha20 nonce, base64url. */
  nonce: string;
  /** AEAD ciphertext of the signed container, base64url. */
  ciphertext: string;
  /** recipient DID (routing/selection). The endpoint already targets them, so this leaks nothing extra. */
  to: string;
}

/** The plaintext that gets encrypted: the signed inner bytes + signature + true sender DID. */
interface SignedContainer {
  /** exact serialized JwmMessage bytes as a UTF-8 string (what the signature covers). */
  payload: string;
  /** Ed25519 signature over utf8(payload), base64url. */
  sig: string;
  /** true sender DID (used to resolve the verification key). */
  from: string;
}

/**
 * HKDF info binds the derived key to the algorithm, the recipient DID, and the
 * ephemeral public key — so a key derived for one (recipient, epk) pair cannot
 * be repurposed. MUST stay byte-identical to transport's didcomm_crypto.ts —
 * this is what makes a browser-packed wire decryptable by a Node peer.
 */
function deriveKey(sharedSecret: Uint8Array, recipientDid: string, epk: Uint8Array): Uint8Array {
  const info = new TextEncoder().encode(`OpenVTC-ECDH-ES+XC20P|${recipientDid}|${toBase64url(epk)}`);
  return hkdf(sha256, sharedSecret, new Uint8Array(0), info, 32);
}

export interface PackArgs {
  sender: BrowserIdentity;
  recipientDid: string;
  message: JwmMessage;
}

/** Sign-then-encrypt `message` for `recipientDid`. Returns the JSON wire string to POST. */
export function packMessage({ sender, recipientDid, message }: PackArgs): string {
  const recipient = resolveDidPeer(recipientDid);

  // 1. Serialize the inner message and sign the exact bytes.
  const payload = JSON.stringify(message);
  const payloadBytes = new TextEncoder().encode(payload);
  const sig = ed25519.sign(payloadBytes, sender.signingSecretKey);

  const container: SignedContainer = { payload, sig: toBase64url(sig), from: sender.did };
  const containerBytes = new TextEncoder().encode(JSON.stringify(container));

  // 2. ECDH-ES: fresh ephemeral X25519 key -> shared secret with recipient static key.
  const ephemeralSecret = x25519.utils.randomSecretKey();
  const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
  const sharedSecret = x25519.getSharedSecret(ephemeralSecret, recipient.keyAgreementPublicKey);
  const key = deriveKey(sharedSecret, recipientDid, ephemeralPublic);

  // 3. AEAD encrypt with a fresh random 24-byte nonce.
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(containerBytes);

  const wire: EncryptedWire = {
    typ: "application/openvtc-encrypted+json",
    alg: "ECDH-ES+XC20P",
    epk: toBase64url(ephemeralPublic),
    nonce: toBase64url(nonce),
    ciphertext: toBase64url(ciphertext),
    to: recipientDid,
  };
  return JSON.stringify(wire);
}

export interface UnpackArgs {
  recipient: BrowserIdentity;
  wire: string;
}

export interface UnpackResult {
  from: string;
  message: JwmMessage;
}

/**
 * Decrypt-then-verify `wire` addressed to `recipient`. Throws on any failure
 * (wrong recipient, AEAD tamper, bad signature, or from-binding mismatch) — a
 * caller must treat any throw as "drop and (audit-)log", never as a partial.
 */
export function unpackMessage({ recipient, wire }: UnpackArgs): UnpackResult {
  const parsed = JSON.parse(wire) as Partial<EncryptedWire>;
  if (parsed.alg !== "ECDH-ES+XC20P" || typeof parsed.epk !== "string" || typeof parsed.nonce !== "string" || typeof parsed.ciphertext !== "string") {
    throw new Error("unpackMessage: not an OpenVTC encrypted wire");
  }
  if (typeof parsed.to === "string" && parsed.to !== recipient.did) {
    throw new Error("unpackMessage: message not addressed to this recipient");
  }

  const epk = fromBase64url(parsed.epk);
  const sharedSecret = x25519.getSharedSecret(recipient.keyAgreementSecretKey, epk);
  const key = deriveKey(sharedSecret, recipient.did, epk);

  // AEAD decrypt — throws on any tamper / wrong key.
  const containerBytes = xchacha20poly1305(key, fromBase64url(parsed.nonce)).decrypt(fromBase64url(parsed.ciphertext));
  const container = JSON.parse(new TextDecoder().decode(containerBytes)) as Partial<SignedContainer>;
  if (typeof container.payload !== "string" || typeof container.sig !== "string" || typeof container.from !== "string") {
    throw new Error("unpackMessage: malformed signed container");
  }

  // Resolve the sender's verification key from the claimed sender DID and
  // verify the signature over the EXACT transmitted payload bytes.
  const senderDoc = resolveDidPeer(container.from);
  const payloadBytes = new TextEncoder().encode(container.payload);
  const sigOk = ed25519.verify(fromBase64url(container.sig), payloadBytes, senderDoc.signingPublicKey);
  if (!sigOk) throw new Error("unpackMessage: signature verification failed");

  const message = JSON.parse(container.payload) as JwmMessage;
  // from-binding: the signed message's `from` must equal the DID whose key we just verified against.
  if (message.from !== container.from) {
    throw new Error("unpackMessage: from-binding mismatch (signed sender does not match signing DID)");
  }

  return { from: container.from, message };
}
