# Result report — demo 3 (webrtc) and demo 6 (ladder)

Worktree: `../wt-webrtc`, branch `feat/webrtc-ladder`. Committed locally
(commit `156f6c9`), matching the handover's "commit locally" instruction.
**Not pushed** — the handover said to ask first.

## 1. The feasibility gate, done first, with real numbers

Measured with the app's own `qrcode` dependency at its own settings
(`errorCorrectionLevel: 'M'`, `apps/demo/src/ui/qr.ts`), against **real**
`RTCPeerConnection` SDP gathered in real Chromium (Playwright,
`iceServers: []` — no STUN/TURN, host candidates only, the same-WiFi target
case). Baseline for comparison: this app's own connect-envelope QR, already
proven to scan on a phone in demos 1/2, is **312 bytes → QR v13 (69×69
modules)**.

| Encoding | Candidates | Bytes | QR version | Modules |
|---|---|---:|---:|---:|
| Naive JSON-wrapped raw SDP | 1 | 587 | **v18** | 89×89 |
| Naive JSON-wrapped raw SDP | 4 | 974 | **v25** | 117×117 |
| This build's tight encoding (real app, real browser walk) | 1 | **208** | **v10** | 57×57 |
| Tight encoding, isolated measurement | 1 | 184 | v10 | 57×57 |
| Tight encoding, isolated measurement | 3 | 286 | v12 | 65×65 |
| Tight encoding, isolated measurement | 4 | 337 | v14 | 73×73 |

**Verdict: the naive path does not fit at a comfortable margin (v18–v25 is
1.4–2× the module count of the app's own proven-scannable code); a
strip-and-rebuild encoding does, staying at or below that proven baseline
even in a 4-candidate worst case.** This is why demo 3 ships the tight
encoding as its *only* QR path, not a fallback — the naive path was never
shipped anywhere.

What "tight" means (`apps/demo/src/webrtc_sdp.ts`): keep only
`ice-ufrag`, `ice-pwd`, the DTLS fingerprint (as 32 raw bytes, base64url —
not the hex-with-colons SDP form, which alone is over half the naive
payload), the `a=setup` role, the SCTP port and max-message-size, and each
UDP *host* candidate as `address:port`. Rebuild a spec-shaped SDP string
from that on the receiving side. Verified against a real
`RTCPeerConnection.setRemoteDescription` (not just string round-tripping):
the rebuilt SDP is accepted in both directions (offer and answer) — see
`apps/demo/test/webrtc_sdp.test.ts`. Chrome's default privacy behaviour
(per-session random `.local` mDNS hostnames instead of raw IPs) is what's
actually in these numbers, not an idealised short IP literal — the 208-byte
figure is what a real device will actually produce.

Not verified: Safari/WebKit or Firefox SDP shape (no such engine available
in this environment; the fields kept are all standard per RFC 8839/8841/8842,
not Chromium-specific, so cross-engine acceptance is expected but unconfirmed).

## 2. What rungs work on what networks

**Same-machine, tested, real two-browser-context walk** (not two peer
connections in one page — two separate Playwright contexts, i.e. two actual
devices' worth of isolation), reusing the actual shipped UI, not a script:

- The full webrtc ceremony (offer QR → paste → answer QR → paste →
  connecting screen) runs correctly end to end with **no page errors** and
  **no hangs** on both sides.
- The QR payloads produced during the real walk were 208 bytes each,
  matching the isolated measurement above.
- **ICE connectivity itself did not complete in this sandboxed environment**
  — both sides reached the 'failed' terminal state after
  `CONNECT_TIMEOUT_MS` (10s), not 'open'. This was investigated, not just
  observed: raw UDP loopback from Node works fine on both `127.0.0.1` and
  the real LAN IP (`192.168.8.130`) in this same environment, so it is not a
  system-wide firewall block; a single headless-Chromium `--allow-loopback-in-peer-connection`
  attempt did not change the outcome either. The most likely explanation is
  a headless-Chromium/sandbox restriction on ICE connectivity checks in this
  specific CI-like setup (plausibly macOS Local Network Access permission
  never having been granted to a Playwright-downloaded, terminal-launched
  Chromium binary) — not confirmable further from here (`TCC.db` requires
  Full Disk Access this session doesn't have). **This means rung 2's actual
  data-channel-opening has NOT been confirmed working on real hardware.**
  What IS confirmed: the ceremony mechanics, the QR sizes, the SDP
  reconstruction accepted by a real `RTCPeerConnection`, and — critically —
  that a failure here degrades cleanly (real message, real terminal state,
  no hang) rather than spinning forever.
- The escape hatch ("Über den Server versuchen") was exercised after a real
  connect-timeout failure: it brings up the relay channel and returns to the
  connect screen without crashing.
- Demo 6's automatic rung-3 fall-through was exercised with **no webrtc
  ceremony run at all**: after only the ordinary connect ceremony (which now
  also mints a did:peer:2 identity in webrtc/ladder mode, so the fallback
  has an address to use), asking went straight to `askOverRelay` — confirmed
  by the relay-send-failure screen (`t('relaySendFailed')`), which is only
  reachable via that code path. No manual tap, no QR shown first.

**Not tested**: two real phones/laptops on the same Wi-Fi. That is the
actual target case for rung 2 and the one thing this report cannot certify
from a single sandboxed machine — recommend as the immediate next step
before showing demo 3 to anyone, given the ICE-connectivity gap above.
**Also not tested**: rung 3's actual round trip against a live relay server
(none was running in this local environment — the `ws://.../relay/drain`
404 is the same, pre-existing gap demo 2 has in this same local-preview
setup; confirmed identical on the untouched `primary-repo` build as a
control, so this is environmental, not a regression).

## 3. What was built

- `apps/demo/src/webrtc_sdp.ts` — pure SDP↔tight-JSON transform (no DOM, no
  RTCPeerConnection), unit tested.
- `apps/demo/src/webrtc.ts` — `RTCPeerConnection`/`RTCDataChannel` wrapper:
  offerer/answerer ceremony, status machine, gathering and connect timeouts,
  send/receive of the same `Envelope` JSON `wire.ts` already produces.
- `apps/demo/src/mode.ts` — `WotMode` extended to `'qr' | 'relay' | 'webrtc' | 'ladder'`.
  Unset still `'qr'`, `'relay'` still exactly `'relay'` — both byte-identical
  to before; any unrecognised value (typos included) still falls to `'qr'`.
- `apps/demo/src/i18n.ts` — new strings, German first, plain register, no em
  dashes (checked with `grep`).
- `apps/demo/src/main.ts` — demo 3/6 UI: a webrtc card on the connect screen
  (offer/accept ceremony, status badge, failure screen with the escape
  hatch), ask/answer routed over the open data channel when available, and
  ladder mode's automatic rung-2-then-rung-3 dispatch with a visible rung
  badge (`rungBadgeText`) shown on the in-flight and result screens.
- Demo 3 = `VITE_WOT_MODE=webrtc`. Demo 6 (ladder) = `VITE_WOT_MODE=ladder`,
  a **separate mode**, not a change to demo 3's behaviour — chosen because
  demo 3's whole claim is "no server in the path," and a silent relay
  fallback baked into the same build would make that claim false mid-demo
  (I7, honest labelling). Each URL now demonstrates exactly one thing.

`packages/transport/src/ladder_channel.ts` was **not touched**. Its own
header states its scope is `relay | lan_http` only, with webrtc explicitly
deferred per `core-transport-plan.md §0` — the handover's premise that this
file "already exists for the daemon side" and could be followed directly was
not quite right; it exists, but doesn't model a webrtc rung. What was reused
instead is its *shape* — named rungs, ordered attempt, advance-on-failure,
a visible outcome — reimplemented in `main.ts` against this app's own
Envelope/relay/webrtc primitives, which have a different call shape than
`packages/transport`'s `DeliveryChannel` interface. Worth flagging: the
daemon's ladder order is relay→lan_http; this demo's is webrtc→relay —
different rungs, mirrored vocabulary only.

## 4. What each rung protects, precisely

- **Rung 1 (QR only, demo 1):** unchanged, untouched.
- **Rung 2 (webrtc, demo 3):** once open, no server anywhere in the path —
  stronger than demo 2's "the server cannot read it," because here there is
  no server. Still not proven end-to-end confidentiality against someone who
  saw both QR codes (same non-authenticated-KEX caveat as demo 1/2's
  `derivePairKey`). ICE reveals each side's local network address (or a
  session-random mDNS hostname) to the other; an observer on the same Wi-Fi
  sees the DTLS/SCTP flow's timing and size, not its content. No TURN
  server exists in this project, so cross-network pairs (different Wi-Fi,
  most mobile-data pairings, client/AP-isolated Wi-Fi) will not connect —
  this is rung 2 legitimately not applying, not a bug, and the UI says so
  (`webrtcExplain`, `webrtcFailedBody`).
- **Rung 3 (relay, demo 2/6):** unchanged claim — server sees traffic
  metadata (who/when), never plaintext.

`gate.ts`'s consent gate, the k-anonymity floor, and the byte-identical
PASS/shared envelope are untouched and apply on every rung: the transport
dispatch in `askWith`/`emitAnswer` branches only on which rung is *reachable*
(peer/channel presence), never on outcome or consent — same discipline the
original relay branch already had, now documented as holding across every
rung added.

## 5. Tests

- `apps/demo`: **258/258 vitest tests pass** (19 files), including 14 new
  tests in `webrtc_sdp.test.ts` (extraction, round-trip, malformed-input
  safety, a QR-size regression guard) and 2 new `mode.test.ts` cases.
  `npx tsc --noEmit` clean.
- `seven_steps.mjs` against a **fresh demo-1 build**: **20/20 checks pass**
  (byte-identity of decline/no-match, k-anonymity, the whole seven-step
  walk) — demo 1 is untouched.
- `seven_steps.mjs` against demo 2 (relay mode): same single failure
  (`ws://.../relay/drain` 404 — no live relay server locally) reproduced
  identically on the **untouched `primary-repo`** build, confirmed as a
  pre-existing environmental gap, not a regression.
- Three ad hoc real-two-browser-context walks (not committed — throwaway
  scripts in the scratchpad, described above): demo 3's full ceremony +
  escape hatch, demo 6's automatic rung-3 fallback. All passed except the
  ICE-connectivity item already called out as unconfirmed in section 2.
- Found and fixed one real bug during this testing: the answer-QR screen in
  `startWebrtcAccept` was being replaced by the connecting screen before the
  other device had a chance to scan it (`showCodeScreen` returns as soon as
  it renders, it does not wait for a scan) — fixed by giving it the same
  manual "next" tap the offer side already had (`webrtcAnswerDone`).

## 6. Not finished / follow-ups

- Real-device (two phones or a phone+laptop, same Wi-Fi) confirmation that
  rung 2 actually opens a data channel — the one thing this report cannot
  certify from here. Do this before showing demo 3.
- Cross-browser SDP-rebuild acceptance (Safari/WebKit, Firefox) — untested,
  no such engine available in this environment.
- `apps/hub` (the demos overview page) was not updated with demo 3/6 cards —
  out of scope of "work in apps/demo," and deployment (`scripts/deploy_wot.sh`,
  pushing to questhub) was not touched or run at all; demo 3/6 exist only as
  local builds in this worktree pending your decision to publish them.
- The relay-fallback round trip (rung 3, reached either manually from demo 3
  or automatically from demo 6) was exercised only against a send *attempt*,
  not a real relay server — same gap as demo 2 has in this local setup.

## ❗ Decisions needed

- Push `feat/webrtc-ladder`? Not done yet — the handover said to ask first.
- Real-device testing (two phones on the same Wi-Fi) is the recommended next
  step before demo 3 goes in front of anyone — want me to write a short
  manual test script for that, or will you run it yourself?
- Should `apps/hub`/`scripts/deploy_wot.sh` get demo 3/6 entries now, or
  stay local-only until real-device ICE connectivity is confirmed?
