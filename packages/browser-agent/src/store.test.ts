import { beforeEach, describe, expect, it } from "vitest";
import { clearIdentity, loadOrCreateIdentity } from "./store.js";

describe("loadOrCreateIdentity / clearIdentity", () => {
  beforeEach(async () => {
    await clearIdentity();
  });

  it("mints and persists an identity on first call", async () => {
    const identity = await loadOrCreateIdentity();
    expect(identity.did.startsWith("did:peer:2.")).toBe(true);
    expect(identity.signingSecretKey.byteLength).toBeGreaterThan(0);
    expect(identity.keyAgreementSecretKey.byteLength).toBeGreaterThan(0);
  });

  it("returns the SAME did and SAME key bytes on a simulated reload (fresh call, same fake-indexeddb)", async () => {
    const first = await loadOrCreateIdentity();

    // Simulate a page reload: nothing here reuses any in-memory object from
    // `first` except the underlying (fake) IndexedDB the browser would keep
    // across reloads — every call below opens its own fresh IDBDatabase
    // connection.
    const second = await loadOrCreateIdentity();

    expect(second.did).toBe(first.did);
    expect(second.signingSecretKey).toEqual(first.signingSecretKey);
    expect(second.keyAgreementSecretKey).toEqual(first.keyAgreementSecretKey);
  });

  it("ignores endpoint overrides once an identity is already persisted", async () => {
    const first = await loadOrCreateIdentity({ endpoint: "https://relay.one/inbox" });
    const second = await loadOrCreateIdentity({ endpoint: "https://relay.two/inbox" });
    expect(second.did).toBe(first.did);
  });

  it("two independently generated stores (different clears) produce different identities", async () => {
    const first = await loadOrCreateIdentity();
    await clearIdentity();
    const second = await loadOrCreateIdentity();
    expect(second.did).not.toBe(first.did);
  });

  it("clearIdentity removes the persisted identity", async () => {
    await loadOrCreateIdentity();
    await clearIdentity();

    // After clearing, IndexedDB should have no record — verified indirectly:
    // the next load mints a fresh identity rather than returning a cached
    // one (already covered above). Here we assert clearIdentity resolves
    // cleanly even when called on an already-empty store (idempotent).
    await expect(clearIdentity()).resolves.toBeUndefined();
  });
});
