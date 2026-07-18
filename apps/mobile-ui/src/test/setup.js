// @ts-check
// jsdom lacks matchMedia; the mockup reads it at import time. Return
// reduced-motion ON so confetti/scan/weaving/spectrum no-op in tests (also
// sidesteps flaky rAF). getContext('2d') returning null is guarded in-code.

if (!window.matchMedia) {
  // @ts-ignore - minimal MediaQueryList shim for jsdom
  window.matchMedia = (query) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom's getContext isn't implemented and logs a warning; return null so the
// in-code guards (fakeQR/drawMap/confetti) no-op cleanly and output stays quiet.
// @ts-ignore - test shim
HTMLCanvasElement.prototype.getContext = () => null;
