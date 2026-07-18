// Sign-then-encrypt message packing for the DIDComm-shaped transport.
//
// Scheme (documented as a deviation set in docs/TRANSPORT.md — this is
// DIDComm-v2-SHAPED, NOT the JWM/JWE wire the RFC specifies):
//
//   sender authenticity  : Ed25519 signature over the exact serialized inner
//                          message bytes. The signature (and the sender DID)
//                          live INSIDE the encrypted payload, so authorship is
//                          confidential (anon-crypt outer, auth-crypt intent).
//   confidentiality      : X25519 ECDH-ES (fresh ephemeral sender key) with the
//                          recipient's static key-agreement key → HKDF-SHA256
//                          → XChaCha20-Poly1305 AEAD. 24-byte random nonce,
//                          never reused, transmitted alongside the ciphertext.
//   from-binding         : on unpack we verify BOTH (a) the signature against
//                          the key resolved from the claimed sender DID, and
//                          (b) that the signed message's `from` equals that DID.
//
// We sign-then-transmit the EXACT inner bytes (not a re-canonicalized parse),
// so signature verification can never disagree with the parser about which
// bytes were signed.
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import type { Identity } from "./did_identity.js";
import { resolveDidPeer } from "./did_identity.js";

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

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function unb64u(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

/**
 * HKDF info binds the derived key to the algorithm, the recipient DID, and the
 * ephemeral public key — so a key derived for one (recipient, epk) pair cannot
 * be repurposed.
 */
function deriveKey(sharedSecret: Uint8Array, recipientDid: string, epk: Uint8Array): Uint8Array {
  const info = new TextEncoder().encode(`OpenVTC-ECDH-ES+XC20P|${recipientDid}|${b64u(epk)}`);
  return hkdf(sha256, sharedSecret, new Uint8Array(0), info, 32);
}

export interface PackArgs {
  sender: Identity;
  recipientDid: string;
  message: JwmMessage;
}

/** Sign-then-encrypt `message` for `recipientDid`. Returns the JSON wire string to POST. */
export function packMessage({ sender, recipientDid, message }: PackArgs): string {
  const recipient = resolveDidPeer(recipientDid);

  // 1. Serialize the inner message and sign the exact bytes.
  const payload = JSON.stringify(message);
  const payloadBytes = new TextEncoder().encode(payload);
  const sig = ed25519.sign(payloadBytes, sender.signing.secretKey);

  const container: SignedContainer = { payload, sig: b64u(sig), from: sender.did };
  const containerBytes = new TextEncoder().encode(JSON.stringify(container));

  // 2. ECDH-ES: fresh ephemeral X25519 key → shared secret with recipient static key.
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
    epk: b64u(ephemeralPublic),
    nonce: b64u(nonce),
    ciphertext: b64u(ciphertext),
    to: recipientDid,
  };
  return JSON.stringify(wire);
}

export interface UnpackArgs {
  recipient: Identity;
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

  const epk = unb64u(parsed.epk);
  const sharedSecret = x25519.getSharedSecret(recipient.keyAgreement.secretKey, epk);
  const key = deriveKey(sharedSecret, recipient.did, epk);

  // AEAD decrypt — throws on any tamper / wrong key.
  const containerBytes = xchacha20poly1305(key, unb64u(parsed.nonce)).decrypt(unb64u(parsed.ciphertext));
  const container = JSON.parse(new TextDecoder().decode(containerBytes)) as Partial<SignedContainer>;
  if (typeof container.payload !== "string" || typeof container.sig !== "string" || typeof container.from !== "string") {
    throw new Error("unpackMessage: malformed signed container");
  }

  // Resolve the sender's verification key from the claimed sender DID and
  // verify the signature over the EXACT transmitted payload bytes.
  const senderDoc = resolveDidPeer(container.from);
  const payloadBytes = new TextEncoder().encode(container.payload);
  const sigOk = ed25519.verify(unb64u(container.sig), payloadBytes, senderDoc.signingPublicKey);
  if (!sigOk) throw new Error("unpackMessage: signature verification failed");

  const message = JSON.parse(container.payload) as JwmMessage;
  // from-binding: the signed message's `from` must equal the DID whose key we just verified against.
  if (message.from !== container.from) {
    throw new Error("unpackMessage: from-binding mismatch (signed sender does not match signing DID)");
  }

  return { from: container.from, message };
}
