import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { ensureMatrixCryptoStub } from "./matrix_crypto_stub.js";

const NATIVE_CRYPTO_MODULE = "@matrix-org/matrix-sdk-crypto-nodejs";

describe("ensureMatrixCryptoStub", () => {
  it("is idempotent — safe to call from every file that touches matrix-bot-sdk", () => {
    expect(() => {
      ensureMatrixCryptoStub();
      ensureMatrixCryptoStub();
      ensureMatrixCryptoStub();
    }).not.toThrow();
  });

  it("leaves the native module requirable without throwing either way (probe succeeded, or the fallback patch caught the failure)", () => {
    ensureMatrixCryptoStub();
    // This is exactly what matrix-bot-sdk's CryptoClient.js/RustEngine.js do
    // internally — the point of the probe-then-patch design is that this
    // call never throws, regardless of whether a real native binary is
    // present on the current platform.
    expect(() => createRequire(import.meta.url)(NATIVE_CRYPTO_MODULE)).not.toThrow();
  });

  it("on this development machine (no darwin-arm64 binary available), the fallback stub is what's installed", () => {
    ensureMatrixCryptoStub();
    // Documents current reality here, not a general contract: if this
    // assertion ever starts failing because the object is no longer empty,
    // that means a real native binary loaded successfully on whatever
    // machine is running this test — which is the desired outcome the
    // probe-then-patch design exists to allow, not a regression.
    const result = createRequire(import.meta.url)(NATIVE_CRYPTO_MODULE) as Record<string, unknown>;
    expect(Object.keys(result)).toHaveLength(0);
  });
});
