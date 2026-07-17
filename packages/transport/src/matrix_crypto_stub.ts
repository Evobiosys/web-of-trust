// Platform shim for matrix-bot-sdk's native E2EE dependency — see docs/TRANSPORT.md § E2EE status.
//
// `@matrix-org/matrix-sdk-crypto-nodejs` (the Rust crypto engine matrix-bot-sdk
// links against for RustSdkCryptoStorageProvider) ships no npm-published
// prebuilt binary for darwin-arm64; its own postinstall downloader
// (download-lib.js, fetching from github.com release assets) is unreachable
// from this machine's outbound network policy. Import path independently
// confirmed empirically: `pnpm approve-builds` + running the vendor's own
// download-lib.js both hang on DNS resolution to github.com (registry.npmjs.org
// is reachable; github.com is not, in this environment).
//
// Without a shim, this is fatal for MatrixTransport entirely — not just E2EE:
// matrix-bot-sdk's `e2ee/CryptoClient.js` and `e2ee/RustEngine.js` both do an
// unconditional top-level `require("@matrix-org/matrix-sdk-crypto-nodejs")`,
// reached via `matrix-bot-sdk`'s barrel `index.js` re-exporting CryptoClient
// even for callers who only want plain (unencrypted) MatrixClient. So merely
// `import { MatrixClient } from "matrix-bot-sdk"` throws MODULE_NOT_FOUND on
// this platform, before any crypto feature is ever touched.
//
// Fix: probe first — attempt the real `require(NATIVE_CRYPTO_MODULE)` once.
// If it succeeds (a working native binary IS present — a future darwin
// build, a linux-arm64 container, whatever), do nothing at all: the real
// module stays in Node's module cache from the probe and every subsequent
// `require` of it (from CryptoClient.js/RustEngine.js) resolves normally,
// crypto works as matrix-bot-sdk intends. Only if the probe throws do we
// patch Node's CJS loader (`Module._load`) to return an empty stub object
// for that one specifier instead of propagating the error. This is safe
// because nothing at *module-evaluation* time in CryptoClient.js/RustEngine.js
// touches the native module's exports — every reference is inside instance
// methods that only run if a MatrixClient is constructed WITH a
// RustSdkCryptoStorageProvider (which MatrixTransport never does — see
// [S3] in docs/TRANSPORT.md). The probe is imported (for its side effect)
// before any `matrix-bot-sdk` import in every file in this package that
// touches matrix-bot-sdk.
//
// Note: even when the real binary loads, MatrixTransport still never
// constructs a RustSdkCryptoStorageProvider today, so E2EE remains [S3]
// (unimplemented, not merely unblocked) either way — this file only ensures
// the binary's *presence or absence* is never the reason crypto can't work;
// wiring it up is separate, future work.
import Module, { createRequire } from "node:module";

const NATIVE_CRYPTO_MODULE = "@matrix-org/matrix-sdk-crypto-nodejs";

type LegacyModuleLoader = typeof Module & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};

let installed = false;

export function ensureMatrixCryptoStub(): void {
  if (installed) return;
  installed = true;

  const moduleWithLoad = Module as LegacyModuleLoader;
  const originalLoad = moduleWithLoad._load.bind(Module);

  try {
    // Probe: does the real native module actually load on this platform?
    // `createRequire` gives us a proper CJS `require` (this file is ESM, so
    // there's no ambient `require`/`module` to call `Module._load` with
    // directly) — resolution happens exactly as it would for matrix-bot-sdk's
    // own `require(...)` calls, from this same node_modules tree.
    createRequire(import.meta.url)(NATIVE_CRYPTO_MODULE);
    // It loaded — leave Module._load untouched. The successful require above
    // is already in Node's shared module cache (keyed by resolved path, not
    // by which `require` performed the load), so every later require of the
    // same specifier — including from within matrix-bot-sdk — resolves to
    // the cached real module without needing this patch at all.
    return;
  } catch {
    // It doesn't (missing platform binary, corrupt file, etc.) — fall
    // through and install the suppressing patch below.
  }

  moduleWithLoad._load = (request: string, parent: unknown, isMain: boolean) => {
    if (request === NATIVE_CRYPTO_MODULE) {
      return {};
    }
    return originalLoad(request, parent, isMain);
  };
}

// Side effect on import — see file header for why this must run before any
// `matrix-bot-sdk` import elsewhere in this package.
ensureMatrixCryptoStub();
