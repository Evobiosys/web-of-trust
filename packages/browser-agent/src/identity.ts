// Self-sovereign browser identity: mints a did:peer:2 DID from a fresh
// Ed25519 signing key + X25519 key-agreement key.
//
// REUSE DECISION: this is a browser-safe REIMPLEMENTATION of the
// identity-construction logic in packages/transport/src/did_identity.ts
// (Ed25519 + X25519 keys, did:peer:2 V/E/S element encoding) — not an import
// of that package. Rationale: transport's package.json depends on `ws` and
// `matrix-bot-sdk` (node-only), and its top-level entry (dist/index.js)
// re-exports everything from one barrel, so importing
// `@resource-web/transport` here would pull those node-only deps into the
// browser bundle transitively even though did_identity.ts itself only needs
// `@noble/curves` + `multiformats`, both isomorphic. So: copy the ~30 lines
// of pure identity-construction logic, drop the Buffer-based base64url
// helpers (Buffer isn't guaranteed in a browser bundle) in favor of
// btoa/TextEncoder, and drop the node-only file-persistence code (this
// package persists via IndexedDB instead, see store.ts).
//
// The V/E/S element encoding (multicodec prefixes, purpose codes, element
// order, abbreviated service block shape) is byte-for-byte identical to
// did_identity.ts's algorithm, so a DID minted here resolves the same way
// via that file's `resolveDidPeer`.
//
// HONEST LABELING (I7): did:peer:2-SHAPED, not certified cross-implementation
// interoperable — same caveat as transport's did_identity.ts.
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { base58btc } from "multiformats/bases/base58";

// multicodec varint prefixes for the raw public keys (see multicodec table).
// Must match did_identity.ts exactly so daemon-side resolution round-trips.
const ED25519_PUB_PREFIX = Uint8Array.from([0xed, 0x01]);
const X25519_PUB_PREFIX = Uint8Array.from([0xec, 0x01]);

// did:peer:2 purpose codes, in the fixed order this package always emits.
const PURPOSE_VERIFICATION = "V"; // authentication / assertion (Ed25519)
const PURPOSE_KEY_AGREEMENT = "E"; // keyAgreement (X25519)
const PURPOSE_SERVICE = "S"; // service

const DID_PEER_2_PREFIX = "did:peer:2";

/**
 * Placeholder relay endpoint. A browser peer can't be dialed directly — its
 * did:peer:2 service block must advertise a relay URL, wired in by Task 3.
 * Until then this placeholder keeps the DID structurally valid (V/E keys
 * still resolve) but is NOT a reachable address.
 */
export const PLACEHOLDER_RELAY_ENDPOINT = "https://relay.invalid/pending-task-3";

export interface BrowserIdentity {
  did: string;
  /** Ed25519 signing secret key (raw bytes). */
  signingSecretKey: Uint8Array;
  /** X25519 key-agreement secret key (raw bytes). */
  keyAgreementSecretKey: Uint8Array;
}

export interface GenerateIdentityOptions {
  /** Relay URL to advertise as the DID's DIDCommMessaging service endpoint. */
  endpoint?: string;
}

function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Browser-safe base64url (RFC 4648 §5), no padding. Uses Web `btoa`. */
export function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of {@link toBase64url}. Uses Web `atob`. */
export function fromBase64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeMultibaseKey(prefix: Uint8Array, pubkey: Uint8Array): string {
  const bytes = new Uint8Array(prefix.length + pubkey.length);
  bytes.set(prefix, 0);
  bytes.set(pubkey, prefix.length);
  return base58btc.encode(bytes); // includes the 'z' multibase prefix
}

function decodeMultibaseKey(mb: string, expectedPrefix: Uint8Array): Uint8Array {
  const bytes = base58btc.decode(mb);
  for (let i = 0; i < expectedPrefix.length; i++) {
    if (bytes[i] !== expectedPrefix[i]) {
      throw new Error("did:peer:2 key has an unexpected multicodec prefix");
    }
  }
  return bytes.slice(expectedPrefix.length);
}

/** Abbreviated did:peer:2 service block; `t:"dm"` expands to DIDCommMessaging. */
interface AbbreviatedService {
  t: "dm";
  s: string; // serviceEndpoint URI
  a: string[]; // accept
}

function encodeServiceElement(endpoint: string): string {
  const svc: AbbreviatedService = { t: "dm", s: endpoint, a: ["didcomm/v2"] };
  return PURPOSE_SERVICE + toBase64url(utf8ToBytes(JSON.stringify(svc)));
}

function buildDidPeer2(signingPub: Uint8Array, keyAgreementPub: Uint8Array, endpoint: string): string {
  const vElement = PURPOSE_VERIFICATION + encodeMultibaseKey(ED25519_PUB_PREFIX, signingPub);
  const eElement = PURPOSE_KEY_AGREEMENT + encodeMultibaseKey(X25519_PUB_PREFIX, keyAgreementPub);
  const sElement = encodeServiceElement(endpoint);
  return `${DID_PEER_2_PREFIX}.${vElement}.${eElement}.${sElement}`;
}

export interface ResolvedDid {
  did: string;
  signingPublicKey: Uint8Array;
  keyAgreementPublicKey: Uint8Array;
  serviceEndpoint: string;
}

/**
 * Local resolver: decodes the inline keys + service from a did:peer:2 string.
 * No network, no Buffer — browser-safe counterpart to transport's
 * did_identity.ts#resolveDidPeer (see this file's header REUSE DECISION). The
 * V/E/S decode algorithm is byte-for-byte identical to that file's, so a DID
 * minted by either `generateIdentity` here or `createIdentity` there resolves
 * the same way. Throws on any non-did:peer:2 input or malformed element.
 */
export function resolveDidPeer(did: string): ResolvedDid {
  if (!did.startsWith(DID_PEER_2_PREFIX + ".")) {
    throw new Error(`not a did:peer:2 DID: ${did.slice(0, 32)}`);
  }
  const elements = did.slice(DID_PEER_2_PREFIX.length + 1).split(".");
  let signingPublicKey: Uint8Array | undefined;
  let keyAgreementPublicKey: Uint8Array | undefined;
  let serviceEndpoint: string | undefined;

  for (const el of elements) {
    const code = el[0];
    const value = el.slice(1);
    if (code === PURPOSE_VERIFICATION) {
      signingPublicKey = decodeMultibaseKey(value, ED25519_PUB_PREFIX);
    } else if (code === PURPOSE_KEY_AGREEMENT) {
      keyAgreementPublicKey = decodeMultibaseKey(value, X25519_PUB_PREFIX);
    } else if (code === PURPOSE_SERVICE) {
      const svc = JSON.parse(new TextDecoder().decode(fromBase64url(value))) as Partial<AbbreviatedService>;
      if (typeof svc.s !== "string") throw new Error("did:peer:2 service block has no endpoint");
      serviceEndpoint = svc.s;
    }
    // Unknown purpose codes are ignored (forward-compat), matching resolvers.
  }

  if (!signingPublicKey) throw new Error("did:peer:2 missing a verification (V) key");
  if (!keyAgreementPublicKey) throw new Error("did:peer:2 missing a key-agreement (E) key");
  if (!serviceEndpoint) throw new Error("did:peer:2 missing a service (S) endpoint");
  return { did, signingPublicKey, keyAgreementPublicKey, serviceEndpoint };
}

/**
 * Mints a fresh browser identity: an Ed25519 signing key, an X25519
 * key-agreement key, and the did:peer:2 DID that encodes both plus a service
 * endpoint. Randomness comes from `@noble/curves`' RNG, which is
 * `crypto.getRandomValues` (Web Crypto) in a browser — never `Math.random`.
 *
 * `opts.endpoint` defaults to `PLACEHOLDER_RELAY_ENDPOINT` until Task 3
 * wires in a real relay URL; the DID structure (and V/E key resolution) is
 * identical either way.
 */
export function generateIdentity(opts?: GenerateIdentityOptions): BrowserIdentity {
  const signingSecretKey = ed25519.utils.randomSecretKey();
  const signingPublicKey = ed25519.getPublicKey(signingSecretKey);
  const keyAgreementSecretKey = x25519.utils.randomSecretKey();
  const keyAgreementPublicKey = x25519.getPublicKey(keyAgreementSecretKey);
  const endpoint = opts?.endpoint ?? PLACEHOLDER_RELAY_ENDPOINT;
  return {
    did: buildDidPeer2(signingPublicKey, keyAgreementPublicKey, endpoint),
    signingSecretKey,
    keyAgreementSecretKey,
  };
}
