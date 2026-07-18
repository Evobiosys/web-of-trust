// IndexedDB persistence for the browser identity, so it survives a page
// reload without re-minting a new DID every time.
//
// HONEST LABELING (alpha, not hardware-backed): secret keys are stored as
// raw bytes in an IndexedDB object store. This is plain browser storage —
// NOT protected by a Secure Enclave, TPM, or non-extractable Web Crypto key.
// Any script with same-origin access (devtools, a same-origin XSS) can read
// these bytes. Acceptable for the alpha browser-identity prototype only; a
// production build must move secrets behind a non-exportable key model or
// an OS-backed credential store.
import { generateIdentity } from "./identity.js";
import type { BrowserIdentity, GenerateIdentityOptions } from "./identity.js";

const DB_NAME = "wot-identity";
const DB_VERSION = 1;
const STORE_NAME = "identity";
const RECORD_KEY = "self";

interface StoredIdentityRecord {
  did: string;
  signingSecretKey: ArrayBuffer;
  keyAgreementSecretKey: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("failed to open IndexedDB"));
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function getRecord(db: IDBDatabase): Promise<StoredIdentityRecord | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
    req.onsuccess = () => resolve(req.result as StoredIdentityRecord | undefined);
    req.onerror = () => reject(req.error ?? new Error("failed to read identity from IndexedDB"));
  });
}

function putRecord(db: IDBDatabase, record: StoredIdentityRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record, RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("failed to persist identity to IndexedDB"));
  });
}

function deleteRecord(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("failed to clear identity from IndexedDB"));
  });
}

/**
 * Loads the persisted identity from IndexedDB, or mints and persists a new
 * one if none exists yet. Safe to call on every app start — a fresh
 * `loadOrCreateIdentity()` call against the same origin's IndexedDB returns
 * the SAME did + SAME secret key bytes every time, until `clearIdentity()`
 * is called.
 *
 * `opts` (endpoint override) is only consulted the first time an identity is
 * minted; it has no effect once one is already persisted.
 */
export async function loadOrCreateIdentity(opts?: GenerateIdentityOptions): Promise<BrowserIdentity> {
  const db = await openDb();
  try {
    const existing = await getRecord(db);
    if (existing) {
      return {
        did: existing.did,
        signingSecretKey: new Uint8Array(existing.signingSecretKey),
        keyAgreementSecretKey: new Uint8Array(existing.keyAgreementSecretKey),
      };
    }
    const identity = generateIdentity(opts);
    await putRecord(db, {
      did: identity.did,
      signingSecretKey: toArrayBuffer(identity.signingSecretKey),
      keyAgreementSecretKey: toArrayBuffer(identity.keyAgreementSecretKey),
    });
    return identity;
  } finally {
    db.close();
  }
}

/** Deletes the persisted identity. Used for testing, sign-out, and reset. */
export async function clearIdentity(): Promise<void> {
  const db = await openDb();
  try {
    await deleteRecord(db);
  } finally {
    db.close();
  }
}
