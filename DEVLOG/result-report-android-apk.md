# Result report -- Android APK, self-hosted install

No worktree created, no code written. Per the handover's own "Honest scope"
clause, the first-action tooling check found the build cannot happen on this
machine yet, so this report is the whole deliverable for this pass.

## Verdict

**Two separate blockers, not one.** Neither is a "nice to have" -- either
alone stops a working, installable, signed APK from coming out of this
machine.

1. **No Android SDK at all.** No `sdkmanager`, no `ANDROID_HOME`/
   `ANDROID_SDK_ROOT`, no `adb`, no `gradle`, no Android Studio, no SDK tree
   under `~/Library/Android/sdk`. There is nothing to compile against and
   nothing to package with.
2. **Even with the SDK installed, the current JDK cannot run the build.**
   The only JDK on this machine is Temurin 26 (`java -version` ->
   `openjdk version "26.0.1"`, `/Library/Java/JavaVirtualMachines/temurin-26.jdk`).
   Gradle and the Android Gradle Plugin (AGP) both cap out at a maximum
   supported JDK per release, and neither has caught up to a JDK released
   2026-04-21. ⚠️ 0.8 -- not verified against AGP's published compatibility
   table for this exact machine (no SDK/AGP installed yet to check against),
   but every AGP release to date has trailed new JDK majors by months, and
   26 is four majors past 21, the version most current AGP docs still cite
   as upper-bound-tested. First `./gradlew assembleRelease` would fail
   before compiling anything, not because of app code.

**Signing is a half-blocker, not a full one.** `keytool` and `jarsigner`
exist (bundled with the JDK) -- keystore *generation* is possible today.
But `jarsigner` only produces a v1/JAR signature, and Android API 30+
(the Pixel 9a's GrapheneOS build is well past that) requires at least APK
Signature Scheme v2. The tool that adds v2 -- `apksigner` -- ships in
Android SDK build-tools, which is absent. So: can make the key, cannot
correctly sign an APK with it yet.

## What exists already, so the next pass doesn't re-check

- `java` (Temurin 26), `keytool`, `jarsigner` -- present, on PATH.
- `sdkmanager`, `adb`, `gradle`, `apksigner`, `zipalign` -- absent.
- Android Studio -- not installed (`/Applications` has no Android Studio).
- Disk: 447 GiB free on `/` -- no space concern for SDK + build-tools + a
  second JDK.
- `brew1 list` shows `temurin` (the 26 formula) already installed via
  Homebrew; nothing android-related installed.

## What the owner needs to install

Machine rule respected: no `brew` command was run. These are handed over,
not executed.

**Route A -- brew (fewer steps, one ownership gotcha):**

```
brew1 install --cask android-commandlinetools
brew1 install --cask temurin@21
```

⚠️ 0.75 -- `brew1` runs installs as user `admin` (`sudo -u admin`), so the
SDK tree lands under `/opt/homebrew/share/android-commandlinetools` owned
by `admin`. A later `sdkmanager --install "platforms;android-35"
"build-tools;35.0.0"` run as the normal user is likely to hit permission
errors on that tree. If Route A is chosen, plan to `sudo chown -R
$(whoami) /opt/homebrew/share/android-commandlinetools` once, immediately
after install, before the first `sdkmanager` call from this session.

**Route B -- user-space, no brew, no sudo (recommended):**

1. Owner downloads the "command line tools only" zip from
   `https://developer.android.com/studio#command-line-tools-only`.
2. `mkdir -p ~/Library/Android/sdk/cmdline-tools && unzip <downloaded>.zip -d ~/Library/Android/sdk/cmdline-tools && mv ~/Library/Android/sdk/cmdline-tools/cmdline-tools ~/Library/Android/sdk/cmdline-tools/latest`
3. `export ANDROID_HOME="$HOME/Library/Android/sdk"` (add to shell profile).
4. `$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses`
5. `$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"`

Everything stays user-owned; no admin/brew involved. ⚠️ Step 1 is a plain
HTTPS download -- if LuLu blocks it, the owner disables LuLu for that one
download and re-enables after. Once the owner says go, I can run steps 2-5
myself in the worktree -- only step 1 (interactive download, or an
owner-authorized fetch) needs the owner.

**JDK 21 side-by-side with the existing Temurin 26** (either route):
install `temurin@21` and point only the Android build at it via
`android/gradle.properties` -> `org.gradle.java.home=<path to 21>`, leaving
the system default JDK 26 untouched for everything else on this machine.

**Route C -- Android Studio.** Heavier download, but bundles its own
JDK 21 runtime and sidesteps blocker 2 entirely. Worth it if the owner
wants a GUI for later debugging (Logcat, layout inspector) rather than a
CLI-only toolchain.

## The handover's five questions, answered honestly

- **Does the camera work in the WebView?** Not reached -- no build exists
  to test. The requirement is known and will be built to spec, not
  discovered by trial: `WebChromeClient.onPermissionRequest` must grant
  `PermissionRequest.RESOURCE_VIDEO_CAPTURE` explicitly (a plain WebView
  denies all permission requests by default), the app must additionally
  hold the runtime `android.permission.CAMERA` grant, and
  `https://app.idea2.site/wot/demo2/` already satisfies the secure-context
  requirement since it's HTTPS. This is the first thing to verify once a
  build exists, per the handover -- not assumed.
- **Sideload steps as they'll appear on his phone?** Not verified. Will not
  invent Play Protect / "unknown sources" prompt wording without seeing it
  on a GrapheneOS build -- GrapheneOS's own installer UI differs from
  stock Android's, which is one more reason not to guess.
- **Where does the keystore live?** Not created yet. Decision to record
  now, before the build pass, since the owner should see it ahead of time:
  intended location is outside this repo entirely, e.g.
  `~/Documents/SingularStructure/PROJECTS/evobiosys/.secrets/web-of-trust-android/release.keystore`
  (a path that is never `git add`-able and is not inside any worktree).
  Losing that file, or its password, means no future update can ever
  install over whatever this first build becomes -- Android refuses
  updates signed with a different key, full stop. It must be backed up
  somewhere durable outside this machine before the first real release
  build is signed with it.
- **Bluetooth?** Unchanged from `result-report-bluetooth.md`: native-only,
  next step after the shell exists. The seam (`connect`/`send`/
  `onEnvelope`/`status`, matching `apps/demo/src/relay.ts` /
  `webrtc.ts`) will be named in the Android project once it exists, not
  built.
- **What was built?** Nothing. No worktree, no `android/` directory, no
  commits. Confirmed via `git status` equivalent reasoning: creating a
  worktree with nothing buildable in it would just be a stall dressed up
  as progress.

## Next pass, once the owner unblocks

1. Owner (or I, once authorized) run Route B steps 1-5, or Route A + the
   chown fix, plus install Temurin 21 alongside 26.
2. `git worktree add ../wt-android -b feat/android-apk`, create
   `android/`, Kotlin + Gradle project, `org.gradle.java.home` pinned to
   the 21 install.
3. WebView wrapping `https://app.idea2.site/wot/demo2/` unchanged, with
   `onPermissionRequest` camera plumbing from day one, not bolted on after
   a failed test.
4. Generate the release keystore with `keytool` at the out-of-repo path
   above; sign with `apksigner` (now available) once build-tools exist.
5. `/wot/install/` download page: APK, signing-key fingerprint, plain-
   language walkthrough of what GrapheneOS will actually show during
   sideload -- written from an observed install, not guessed.
