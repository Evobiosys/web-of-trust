# Handover — an installable Android app, from a link, no Play Store

Worktree: `git worktree add ../wt-android -b feat/android-apk`. New top-level
directory `android/` in the repo. Commit locally.

## What the owner asked for

> if it's possible to build the native android app from a link let's do that,
> i don't want to host it on the play store if i can avoid it, since they
> might insert other things there as well. i guess that means apk

Yes, it means a **self-hosted APK**, downloaded and sideloaded from a page he
controls. Build the smallest honest version of that.

## Why it exists

`DEVLOG/result-report-bluetooth.md` (read it first) establishes that
browser-to-browser Bluetooth is impossible: Web Bluetooth has no peripheral
role. A native app is the only way to reach device-to-device with no network,
so "install from a website" and "Bluetooth" are one task. This handover covers
the shell and the install path. Bluetooth transport itself is the next step and
should be designed for, not built here unless it comes cheaply.

## Build

- One Android project in `android/`, Kotlin, Gradle, minimum sensible API
  level for the owner's Pixel 9a (GrapheneOS, **no Google Play Services** —
  nothing may depend on them).
- A `WebView` wrapping the **existing, unchanged** web app at
  `https://app.idea2.site/wot/demo2/`. Do not fork the web UI.
- The WebView must have what the app needs: camera for scanning, and a secure
  context. Verify the QR scan path actually works inside the WebView, since
  `getUserMedia` in a WebView needs explicit permission plumbing
  (`onPermissionRequest`) that a plain WebView does not do by default. This is
  the most likely thing to be broken; test it, do not assume it.
- Leave a clearly marked seam where a Bluetooth transport would attach later,
  matching the `connect`/`send`/`onEnvelope`/`status` shape that
  `apps/demo/src/relay.ts` and `webrtc.ts` already use. Name it, do not build it.

## The install path

- A download page deployed alongside the demos, at `/wot/install/`, with the
  APK, the fingerprint of the signing key, and **plain instructions for what
  Android will say** when sideloading (the "unknown sources" prompt, the Play
  Protect warning). Do not pretend those warnings will not appear; explain
  them. A page that surprises someone mid-install loses more trust than it
  gains.
- Sign the APK with a locally generated key. **Put the keystore outside the
  repository** and say in the report exactly where it is and that it must be
  backed up, because losing it means no future update can ever install over
  this one.
- Do not upload anything to Google Play, and do not add any dependency that
  phones home.

## Honest scope

If any of this cannot be done here (no Android SDK on this machine, no
signing tooling), **stop and report precisely what is missing and what the
owner needs to install**, rather than half-building. Check for the SDK first:
`sdkmanager`, `ANDROID_HOME`, Android Studio. That check is the first thing
you do.

## Report

`DEVLOG/result-report-android-apk.md`: what was built, whether the camera works
in the WebView, the exact sideload steps as they will actually appear on his
phone, where the keystore lives, and what remains for Bluetooth.
