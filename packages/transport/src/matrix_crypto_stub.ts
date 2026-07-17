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
// Fix: patch Node's CJS loader to return an empty stub object for that one
// module specifier instead of throwing. This is safe because nothing at
// *module-evaluation* time in CryptoClient.js/RustEngine.js touches the
// native module's exports — every reference is inside instance methods that
// only run if a MatrixClient is constructed WITH a RustSdkCryptoStorageProvider
// (which MatrixTransport never does — see [S3] in docs/TRANSPORT.md). The stub
// is imported (for its side effect) before any `matrix-bot-sdk` import in
// every file in this package that touches matrix-bot-sdk.
//
// IMPORTANT for whoever re-enables E2EE later: this patch is UNCONDITIONAL —
// it does not probe whether a real native binary is actually available before
// stubbing it out. So on a future machine/environment where the binary DOES
// load correctly, this file will keep silently suppressing it rather than
// letting E2EE work. Re-enabling E2EE means removing this file (or making it
// conditional on a real-binary probe failing), not just fixing binary
// availability elsewhere.
import Module from "node:module";

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
