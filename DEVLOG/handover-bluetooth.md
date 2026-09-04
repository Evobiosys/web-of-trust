# Handover — a Bluetooth rung, if one is honestly possible

Worktree: `git worktree add ../wt-bluetooth -b feat/bluetooth`. Work in
`apps/demo/`. Commit locally; pushing this repo is fine.

**This lands BEFORE any install/download work. The owner said so explicitly.**

## What the owner asked for

> also make it possible to make a connection with Bluetooth, so I could just
> connect here on Bluetooth and on the phone on Bluetooth

Two devices, both running this web app, connecting over Bluetooth with no
network at all.

## The feasibility gate. Do this FIRST and report before building anything.

There is a strong reason to think the browser-to-browser version is
impossible, and you must settle it before writing a line of UI:

**Web Bluetooth lets a page act as a GATT central (it can scan for and connect
to a peripheral). It does not let a page act as a peripheral, so a browser
cannot advertise itself.** Two browsers therefore have no one to connect to.
Verify this against the current specification and current Chrome/Android
behaviour rather than taking my word for it, and report what you find with
sources. Also check, specifically and separately:

- Web Bluetooth availability in **Brave on Android** and in **Chromium on
  GrapheneOS** (the owner's actual devices; Brave disables some Web APIs by
  default and GrapheneOS may gate the permission).
- Whether any shipping browser exposes a peripheral/advertising API today.
- Whether the Android permission prompt the owner already saw, "allow looking
  for other devices" (this is Local Network Access / nearby devices, not
  Bluetooth), is relevant here at all.

**If browser-to-browser Bluetooth is genuinely not possible, STOP and say so.**
Do not build a fake version, and do not build a UI that asks for Bluetooth
permission and then quietly does something else. Instead, write up in your
report:

1. Precisely why it cannot work in a page, with sources.
2. The smallest real path that WOULD work, which is almost certainly a native
   Android app that can advertise as a peripheral, and what that implies for
   the owner's separate "install it from a website" question. Name the
   concrete API surface (Android `BluetoothLeAdvertiser`, or Nearby
   Connections, or Wi-Fi Direct) and say which is least work for a demo.
3. Whether anything **useful and honest** can still be built in the page
   today. For example: if one side could be a small native helper and the
   browser the central, is that a demo worth having, or is it worse than the
   WebRTC rung we already have?

## If it IS possible

Build it as the same shape as the other rungs: a `VITE_WOT_MODE` value, its
own demo URL, `src/mode.ts` holds the switch. Same envelopes, same consent
gate, same k-anonymity floor, same byte-identical "no answer". Say in the UI
exactly what Bluetooth does and does not protect.

## Context you need

- `src/webrtc.ts` and `src/relay.ts` are the two existing transports; follow
  their interface shape (`connect`, `send`, `onEnvelope`, `status`) so the
  ladder in demo 6 can add a rung without special-casing.
- Demos 1, 2, 3 and 6 are live and being shown to people. Do not change them.
- German first in `src/i18n.ts`, plain register, no em dashes.

## Report

`DEVLOG/result-report-bluetooth.md`. If the answer is "not possible in a
browser", that report IS the deliverable and it should be excellent: the
owner will make a real decision from it about whether to go native.
