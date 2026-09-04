# Result report -- Bluetooth rung feasibility

Worktree: `../wt-bluetooth`, branch `feat/bluetooth`. No code changed.
Demos 1, 2, 3, 6 untouched. This report is the whole deliverable, per the
handover.

## Verdict

**Browser-to-browser Bluetooth is not possible today, and the current spec
gives no timeline for it changing.** Web Bluetooth defines only a Central
role (a page can scan for and connect to a peripheral); it has never defined
a Peripheral/GATT-server role, so a page cannot advertise, and two browser
tabs have nothing to connect *to*. This is confirmed against the live spec
text, current Chrome documentation, and two W3C tracking issues for exactly
this feature that have been open, unimplemented, since 2016 and 2020. Do not
build a placeholder or a UI that requests Bluetooth permission and then does
something else.

The real path is native code on at least one side. Section 2 names the
concrete API and argues it should be Android `BluetoothLeAdvertiser` +
`BluetoothGattServer`, and section 2 also explains why this collapses into
the owner's separate "install it from a website" task rather than sitting
next to it. Section 3 covers the one honest thing that could still be built
in the page, and argues against building it.

## 1. Why it cannot work in a page

**The spec.** The W3C Community Group's Web Bluetooth specification states
its own scope in the introduction: "The first version of this specification
allows web pages, running on a UA in the Central role, to connect to GATT
Servers over either a BR/EDR or LE connection." [A] There is no Peripheral,
Advertiser, or GATT-server-hosting role defined anywhere in the document.
(webbluetoothcg.github.io/web-bluetooth/, editor's draft, live document,
checked 2026-09-04.)

**Chrome's own docs say the same thing**, unprompted: "This version of the
Web Bluetooth API specification allows websites, running in the Central
role, to connect to remote GATT Servers over a BLE connection." Support is
listed as "request and connect to nearby Bluetooth Low Energy devices,
read/write Bluetooth characteristics" -- central-role verbs only. [A]
(developer.chrome.com/docs/capabilities/bluetooth, checked 2026-09-04.)

**The two issues that would fix this are still open, years later.** The W3C
group tracks peripheral support and advertising support as two separate,
still-open feature requests:

- [#78 "Design Peripheral/GATT Server support"](https://github.com/WebBluetoothCG/web-bluetooth/issues/78)
  -- open. The maintainer's own framing: "It's not a priority for the first
  release, but we can collect ideas here so they don't get lost." [A, spec
  maintainer, contributor `reillyeon` who works on Chromium's implementation]
- [#231 "Advertisement / Beacon Broadcast Support"](https://github.com/WebBluetoothCG/web-bluetooth/issues/231)
  -- open, asking for even the weaker capability of broadcasting an
  advertisement (not a full GATT server).
- A third, narrower request, [#484 "Switch to peripheral mode to
  advertise"](https://github.com/WebBluetoothCG/web-bluetooth/issues/484)
  (opened 2020-03-30), was closed by being folded into the two above, with
  the maintainer's only comment being "Peripheral support is tracked in #78
  and advertising support is #231."

An issue a maintainer explicitly deprioritised in 2016-2020 and that is
still unimplemented in September 2026 is as close to a settled "no" as an
open spec process produces. This is not a stale claim; it is the current
state.

**No shipping browser exposes a peripheral/advertising API today.** Firefox
and Safari implement no Web Bluetooth at all (any role). Chromium-family
browsers implement the central role only, matching the spec exactly; caniuse
puts global central-role support at roughly 78%, entirely from
Chromium-derived engines. [B] (caniuse.com/web-bluetooth, checked
2026-09-04.) There is no browser anywhere, on any platform, implementing the
peripheral half.

### The owner's two specific devices

**Brave on Android: Web Bluetooth is off by default, and the evidence on
whether it can be turned on at all is contradictory.** Brave disabled the
API globally as part of a 2023 privacy pass (`brave-core` PR referenced from
[brave-browser#31605](https://github.com/brave/brave-browser/issues/31605)).
That issue, titled "Put WebBluetooth functionality behind a flag," was
**closed 2023-08-21** with the stated intent: "Once we have audited this
feature and have a good understanding of its privacy properties, we could
provide a flag in `brave://flags` (default off) to allow users who need it
to enable it." [B, Brave engineering, dated] Closing that issue reads as "we
built the flag." But a separate, still-**open** issue,
[brave-browser#34941 "Enable Web Bluetooth"](https://github.com/brave/brave-browser/issues/34941)
(opened 2023-12-16, four months later), and a live community thread as
recent as this year ([community.brave.app, "Web Bluetooth API globally
disabled"](https://community.brave.app/t/console-log-error-web-bluetooth-api-globally-disabled/260497))
[C] both describe the API as still globally disabled with users unable to
find a working flag. Read plainly: a flag may have shipped and then been
walked back, or it never actually reached the point of doing anything, or it
exists but does not cover Android specifically. Whatever the reason, **there
is no confirmed, currently-working way to enable Web Bluetooth in Brave on
the owner's phone.** This is moot regardless, since even a fully-enabled
Brave would still be central-role-only per section 1 above; it only matters
for section 3's hybrid idea.

**GrapheneOS: two independent gates, and one of them is unverified.**
GrapheneOS's browser is Vanadium, a hardened Chromium fork, not "Chromium"
generically (worth the correction since it is the thing that actually
matters here). I found no evidence Vanadium strips the Web Bluetooth API the
way Brave does; GrapheneOS's own features page describes disabling
*hardware* radios by default (Bluetooth, NFC, UWB) and adding site-setting
toggles for other web APIs (WebGPU, WebRTC), but nothing naming Web
Bluetooth specifically as removed. [A, grapheneos.org/features] On top of
whatever the browser does, GrapheneOS gates Bluetooth scanning at the OS
level per-app: Settings > Location > Bluetooth scanning must be on, and the
requesting app (here, Vanadium) needs the "Nearby devices" runtime
permission granted, same as any Android 12+ app. [C, GrapheneOS discuss
forum thread on Bluetooth permissions, page would not render for direct
quoting -- treat this specific claim as ⚠️ 0.6 confidence, corroborated only
by the official features page's general "disabled by default" language, not
a primary quote from that thread]

⚠️ I could not directly confirm whether Vanadium's Bluetooth *chooser
dialog* (the `requestDevice()` picker) fires at all once those two gates are
open. This is answerable on-device in about ten seconds and is cheaper than
more searching: open `chrome://bluetooth-internals/#adapter` in Vanadium, or
visit `https://googlechrome.github.io/samples/web-bluetooth/device-info/`
and tap "Request Bluetooth Device." If a chooser appears (even with zero
devices listed), central-role Web Bluetooth works on that device; if the
button does nothing or throws, it doesn't. This result changes section 3's
answer but not section 1's or the report's verdict.

**What the "allow looking for other devices" prompt the owner already saw
actually is: not Bluetooth.** Chrome 142 (released 2025-10-28, so current on
any up-to-date Chrome/Chromium/Brave/Vanadium today) shipped a new
permission prompt for **Local Network Access (LNA)**, phrased as "look for
and connect to any device on your local network." Chrome's own developer
blog: "Local Network Access restricts the ability of websites to send
requests to servers on a user's local network... requiring the user grant
the site permission before such requests can be made," defined as any
request from the public network to a private IPv4/link-local/loopback
address. [A, developer.chrome.com/blog/local-network-access, dated
2025-10-28, checked 2026-09-04] This is about HTTP/WebSocket-style requests
to LAN devices (mDNS discovery, local dev servers, IoT admin pages), not
Bluetooth in any form. It is almost certainly what fired for the WebRTC rung
(demo 3) or the relay rung's LAN-adjacent calls, not a Bluetooth prompt at
all. The handover's suspicion was correct.

## 2. The smallest real path that would work, and why it is one task, not two

Bluetooth in a page needs one side to advertise and host a GATT server. That
requires native code with the OS-level Bluetooth stack, which today means
**a real installed app**, not a browser tab and not a PWA "add to home
screen" shortcut. This is the crux of the merge the owner asked about:

**A PWA installed from a website does not unlock this.** "Install it from a
website" in the PWA/TWA sense still runs inside the browser's engine and
sandbox; it gets an icon and a standalone window, nothing more. It has
exactly the same Web Bluetooth surface as the tab it came from (central
role only, same gates as section 1). If the owner's mental model is "install
from web -> now it can do more," that model is wrong for Bluetooth
specifically, and worth correcting explicitly so the two tasks don't get
silently merged into a PWA that still can't advertise.

**The one thing that does unlock it is a real APK with Bluetooth
permissions in its manifest.** So "install it from a website" (sideloading
an APK, which is exactly what he'd do next regardless -- GrapheneOS
supports installing from any source per-app, no root needed) and "Bluetooth"
are the same underlying task: write a small native Android app, host the
APK somewhere, have him install it. Treat them as one work item.

### API comparison for the native side

| Option | Peripheral-capable | Needs Play Services | Compatible with a browser as the other side | Cost |
|---|---|---|---|---|
| `BluetoothLeAdvertiser` + `BluetoothGattServer` (AOSP, `android.bluetooth.le`) | Yes | No | **Yes** -- Web Bluetooth's central role is GATT/LE only, so this is the *only* option a browser can talk to | Medium: MTU is small (23 bytes default, negotiable up to ~512), so envelope JSON needs chunking/reassembly on both ends |
| Bluetooth Classic RFCOMM (`BluetoothServerSocket.listenUsingRfcommWithServiceRecord`) | Yes (as a listening socket, not a GATT server) | No | **No** -- Web Bluetooth cannot see or connect to a Classic RFCOMM service at all | Low: no chunking, ordinary stream socket, but throws away the one advantage that matters here |
| Nearby Connections API (`com.google.android.gms.nearby.connection`) | Yes, handles BLE/Classic/Wi-Fi Direct automatically | **Yes** | No (own protocol, not GATT) | Low code, but **ruled out for the owner's GrapheneOS device**, which ships without Google Play Services by default; Sandboxed Google Play is available but is an extra dependency and extra permission grant (Nearby Devices + Location) the project would otherwise avoid |
| Wi-Fi Direct (`android.net.wifi.p2p`) | N/A (different radio) | No | No | High: separate pairing UX, heavier for a few KB of JSON |

**Recommendation: `BluetoothLeAdvertiser` + `BluetoothGattServer`.** It is
the only option that stays compatible with the existing browser-as-central
story (see section 3), it needs no Play Services (works on GrapheneOS as
shipped), and its cost (MTU chunking) is small and well-trodden -- the same
kind of framing problem `webrtc_sdp.ts` already solved for QR payloads in
this codebase, just at a different size budget.

### Smallest combined version

One Android Studio project, not two apps:

1. A `WebView` pointing at the existing built demo bundle (whichever mode is
   live at the URL he'd otherwise open in a browser). This reuses `gate.ts`,
   `wire.ts`, `i18n.ts`, the UI, and the consent flow completely unchanged --
   nothing about the web app's logic moves.
2. One Kotlin file wrapping `BluetoothLeAdvertiser` (advertise) and
   `BluetoothGattServer` (receive) plus, if the same device should also be
   able to initiate, the ordinary `BluetoothLeScanner`/`BluetoothGatt`
   central APIs Android has always had.
3. A JS bridge (`WebView.addJavascriptInterface`) exposing the same four
   verbs the other two transports already standardise on --
   `connect`/`send`/`onEnvelope`/`status`, matching `webrtc.ts` and
   `relay.ts`'s shape exactly -- so `main.ts`'s ladder wiring can add this as
   a rung with no special-casing, same as the handover asked for if it had
   turned out possible in a page.
4. Sideloaded via a link on questhub: APK download, "install unknown apps"
   granted per-app (this is the "install it from a website" task, done).

That is the merged smallest version: one native project, reused UI, one
new transport module behind the existing interface, one install step that
serves both asks at once.

**One topology note the owner should confirm before this gets built.** "I
could just connect here on Bluetooth and on the phone on Bluetooth" is
ambiguous about what "here" is. If "here" is his Mac, desktop Chrome already
speaks Web Bluetooth's central role natively -- no native macOS code needed,
only a one-time OS permission grant (System Settings > Privacy & Security >
Bluetooth > Chrome), and the phone above becomes the only side that needs a
new app. If "here" is a second Android device, both sides need the APK
above, and the Mac's browser doesn't participate at all. These lead to
different, not-quite-overlapping builds; worth a one-line answer from him
before writing code.

## 3. Whether anything honest can be built in the page today

**Nothing browser-only.** Section 1 is unconditional; no combination of
flags or permissions changes it.

**A hybrid (native Android peripheral, browser as central) is technically
buildable, but I recommend against building it as a separate, smaller step
before the merged app in section 2.** Reasoning:

- It only works in one direction. It cannot deliver "the web app, unchanged,
  talking Bluetooth on both sides" -- one side is inescapably a native app
  no matter how small the browser-side lift is. That was true of the fully
  native answer above too, so the hybrid buys nothing on that axis.
- On the owner's actual browsers, it may not even clear the browser side.
  Brave-Android's central role is blocked with no confirmed working
  re-enable path (section 1). Vanadium's is unconfirmed pending the
  ten-second on-device check above. In the worst case -- Brave blocked,
  Vanadium untested-and-off -- the hybrid demo has *no* device of his it
  runs on at all, while the fully native path in section 2 works
  unconditionally because it doesn't depend on either browser's Bluetooth
  support.
- Its one real selling point over the existing WebRTC rung (demo 3) is
  genuine and worth naming: WebRTC in this project needs the two devices on
  the same Wi-Fi with no client/AP isolation (`webrtc.ts`'s own documented
  limitation), while Bluetooth LE needs no network stack at all, not even a
  shared access point. That is a real, honest differentiator, not a
  redundant one.
- But that differentiator only pays off once the peripheral-side native code
  exists, and section 2's merged app already contains that code plus a
  central role plus the install step, for barely more work than the
  peripheral-only hybrid would cost alone. Building the hybrid first would
  mean writing the GATT server once for a throwaway demo, then rewriting it
  again (or extending it) for the real app. Skip the intermediate step.

**Bottom line for section 3: don't build the hybrid as its own thing.** If
the owner wants the "works with zero network at all" property Bluetooth
uniquely offers over the existing rungs, the path there is section 2's
merged native app, not a page-side stopgap.

## What this means for the two "separate" tasks

They are one task. Recommend presenting it to the owner as: "Bluetooth and
'install from a website' are the same build -- one small native Android
app, reusing the existing web UI in a WebView, adding one Bluetooth
transport module behind the same interface `webrtc.ts` and `relay.ts`
already use." Confirm device topology (Mac+phone vs phone+phone) and run
the Vanadium ten-second check before scoping the work further.

## Sources

[A] = spec/vendor official, [B] = maintainer/vendor issue tracker or
aggregated compatibility data, [C] = community forum, unverified beyond the
thread itself.

- [A] W3C Web Bluetooth Community Group, "Web Bluetooth" editor's draft --
  webbluetoothcg.github.io/web-bluetooth/, live document, checked 2026-09-04.
- [A] Chrome for Developers, "Communicating with Bluetooth devices over
  JavaScript" -- developer.chrome.com/docs/capabilities/bluetooth, checked
  2026-09-04.
- [A] Chrome for Developers blog, "New permission prompt for Local Network
  Access" -- developer.chrome.com/blog/local-network-access, 2025-10-28,
  checked 2026-09-04.
- [A] GrapheneOS, "Features overview" -- grapheneos.org/features, checked
  2026-09-04.
- [A] Android Developers, `BluetoothLeAdvertiser` reference --
  developer.android.com/reference/android/bluetooth/le/BluetoothLeAdvertiser,
  checked 2026-09-04.
- [A] Android Developers Blog, "Upcoming Changes to the Nearby Connections
  API" -- developer.android.com/blog/posts/upcoming-changes-to-the-nearby-connections-api,
  2026-07, checked 2026-09-04.
- [B] W3C WebBluetoothCG GitHub, issue #78 "Design Peripheral/GATT Server
  support" (open) -- github.com/WebBluetoothCG/web-bluetooth/issues/78.
- [B] W3C WebBluetoothCG GitHub, issue #231 "Advertisement / Beacon Broadcast
  Support" (open) -- github.com/WebBluetoothCG/web-bluetooth/issues/231.
- [B] W3C WebBluetoothCG GitHub, issue #484 "Switch to peripheral mode to
  advertise" (closed, folded into #78/#231), comment by `reillyeon`,
  2020-03-30 -- github.com/WebBluetoothCG/web-bluetooth/issues/484.
- [B] caniuse.com, "Web Bluetooth" compatibility table, checked 2026-09-04
  -- caniuse.com/web-bluetooth.
- [B] brave/brave-browser GitHub, issue #31605 "Put WebBluetooth
  functionality behind a flag" (closed 2023-08-21) --
  github.com/brave/brave-browser/issues/31605.
- [B] brave/brave-browser GitHub, issue #34941 "Enable Web Bluetooth" (open,
  opened 2023-12-16) -- github.com/brave/brave-browser/issues/34941.
- [C] Brave community forum, "Console log error: Web Bluetooth API globally
  disabled" -- community.brave.app/t/console-log-error-web-bluetooth-api-globally-disabled/260497,
  checked 2026-09-04.
- [C] GrapheneOS discuss forum, "Bluetooth permissions are a bit of a mess"
  -- discuss.grapheneos.org/d/4622-bluetooth-permissions-are-a-bit-of-a-mess
  (page would not render for direct quoting; claim about per-app Nearby
  Devices gating is corroborated by [A] grapheneos.org/features instead,
  this thread cited only as the pointer that surfaced the topic).
