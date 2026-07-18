// @ts-check
// Reduced-motion preference, read once. Animations honour this (celebration,
// scan, weaving, confetti) exactly as the mockup did.

export const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
