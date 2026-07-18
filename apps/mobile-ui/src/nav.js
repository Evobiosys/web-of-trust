// @ts-check
// Screen navigation. show(id) toggles the visible screen, syncs the tab bar,
// and renders the target screen's data — mirroring the mockup's show().

import { $ } from "./dom.js";
import { state } from "./store.js";
import { renderDiscover } from "./screens/discover.js";
import { renderChat } from "./screens/chat.js";
import { renderHost } from "./screens/host.js";
import { renderRings, renderPeople } from "./screens/web.js";
import { renderCeremony } from "./screens/meet.js";
import { renderYou } from "./screens/you.js";

/** @param {string} id */
export function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on"));
  $(id).classList.add("on");
  state.screen = id;
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("on", t.getAttribute("data-go") === id);
  });
  if (id === "discover") renderDiscover();
  else if (id === "meet") renderCeremony("idle");
  else if (id === "web") { renderRings(); renderPeople(); }
  else if (id === "chat") renderChat();
  else if (id === "you") renderYou();
  else if (id === "host") renderHost();
}
