// @ts-check
// Test harness: mount the real index.html phone markup into jsdom, reset the
// store, and boot the app fresh. Keeps tests driving the same DOM the browser
// renders.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { resetState } from "../store.js";
import { bootApp } from "../app.js";

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(here, "../../index.html"), "utf8");
const bodyMatch = indexHtml.match(/<body>([\s\S]*)<\/body>/);
const BODY = (bodyMatch ? bodyMatch[1] : "").replace(/<script[\s\S]*?<\/script>/g, "");

/**
 * Mount the phone DOM, reset state, boot the app. Returns the shared context.
 * @returns {import("../context.js").AppContext}
 */
export function mount() {
  resetState();
  document.body.innerHTML = BODY;
  return bootApp({ mode: "fixture" });
}
