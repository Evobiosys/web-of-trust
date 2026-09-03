# Handover — demo 3: WebRTC, and the connection ladder

Worktree: `git worktree add ../wt-webrtc -b feat/webrtc-ladder` from
`Code/primary-repo`. Work in `apps/demo/`. Commit locally; pushing is fine for
this repo but ask before you do.

## What the owner asked for, in his words

> i want to have the web rtc one built as another version which we might then
> want to incorporate. and then they said something about a layered fallback way
> of connecting which at a later run uses servers but starts without it, maybe
> that is webrtc even

So two things, and the second is the point: a **ladder** that starts with the
least infrastructure and only falls back to more.

Rung 1  QR only, no network at all.            (demo 1, built, do not touch)
Rung 2  WebRTC data channel, no server.        (this task)
Rung 3  Relay store-and-forward.               (demo 2, built, do not touch)

Ship rung 2 as **demo 3**: `VITE_WOT_MODE=webrtc`, base `/wot/demo3/`.
`src/mode.ts` already exists from demo 2 and is where the mode switch lives.

## Why WebRTC is buildable here without a signalling server

The QR codes already in the app can carry the signalling. One device renders
its SDP offer as a QR, the other scans it and renders its answer as a QR, the
first scans that back, and the data channel opens. **No server in the path at
all** — a stronger claim than demo 2's "the server cannot read it".

⚠️ The thing to check FIRST, before any UI: an SDP offer with ICE candidates is
large, and a QR has a hard ceiling. Measure it. Strategies if it does not fit,
in order: trim to host candidates only (same-WiFi is the target case), strip
the SDP to the fields that matter and rebuild it on the other side, compress
before base64. If after honest effort it still will not fit a scannable code,
**stop and report that** — do not ship a QR nobody can scan. The paste channel
is a legitimate fallback for demo 3 specifically, but say so plainly.

Same-network is the honest target. Over the open internet, two browsers behind
symmetric NAT will not connect without TURN, and this project has no TURN
server. The UI must say that rather than spin forever: a timeout, a real
message, and a one-tap "over den Server versuchen" that hands off to rung 3.

## Also build: the ladder itself

`packages/transport/src/ladder_channel.ts` already exists for the daemon side —
read it and follow its shape rather than inventing a second vocabulary. In the
demo app, the ladder tries rung 2 first and falls back to rung 3 on failure,
showing the user which rung it ended up on. That visible rung indicator IS the
demo: people should see it start without a server and only reach for one when
it has to.

Consider making the ladder a fourth mode (`VITE_WOT_MODE=ladder`, demo 6)
rather than changing demo 3's behaviour, so each URL demonstrates exactly one
thing. Your call; say what you chose and why.

## Non-negotiable

- Demos 1 and 2 keep their exact current behaviour. Both are being shown to
  people. `seven_steps.mjs` must still pass against a demo-1 build.
- The consent gate, the k-anonymity floor and the byte-identical "no answer"
  apply on every rung. A new transport does not get an exemption.
- Every user-facing string in `src/i18n.ts`, German first, plain register, no
  em dashes.
- Say what each rung does and does not protect. Do not write "peer to peer,
  fully private" without naming what the other side, or an observer on the same
  network, can still see.

## Report

`DEVLOG/result-report-webrtc-ladder.md`: the SDP-in-QR measurement with real
numbers, what rungs work on what networks (test at least same-machine), test
counts, and anything you could not finish.
