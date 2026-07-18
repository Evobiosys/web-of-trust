// Polyfills `indexedDB` (and friends) as globals for jsdom, which does not
// implement IndexedDB itself. Import order matters: this must run before any
// test module touches `globalThis.indexedDB`, which is why it's wired in as
// vitest's `setupFiles` rather than imported ad hoc per test file.
import "fake-indexeddb/auto";
