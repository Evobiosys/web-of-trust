# Handover — scan once, from a link, and stay connected

Worktree: `git worktree add ../wt-onescan -b feat/one-scan-link` from
`Code/primary-repo`. Work in `apps/demo/`. Another stream is editing
`src/main.ts` at the same time, so keep your edits there small and localised and
prefer new modules. Commit locally; pushing this repo is fine.

## The experience the owner wants, in his words

> i want to scan something once from one device such as a laptop and then be
> able to stay connected without scanning again, after the new device such as a
> phone has downloaded something from the internet (android to start)
> and the qr code should have a link since on my graphene phone i cant use
> something else

Read that literally. Today the connect QR contains JSON, so a phone's built-in
camera has nothing to open. On GrapheneOS he cannot install a separate scanner
app, so **the QR must encode a URL** that the system camera offers to open.
One scan, on the phone, from the laptop's screen. The phone opens the link,
loads the app, and is connected. **No second scan in the other direction.**

## The shape

The laptop shows a QR encoding something like:

    https://app.idea2.site/wot/demo2/?connect=<did>&n=<nonce>&name=<display>

The phone's camera opens it, the app boots, reads the parameters, mints its own
identity, stores the laptop as a peer, and registers with the relay. It is then
connected and stays connected across reloads (subject to `storageIsEphemeral()`
— on a phone that blocks storage this lasts the visit, which is acceptable;
say so in the UI rather than pretending).

**The asymmetry to solve, and the most important part of this task:** the phone
now knows the laptop, but the laptop does not yet know the phone, and the owner
has ruled out a second scan. So the phone must tell the laptop over the relay:
after it registers, it sends its own DID and nonce to the laptop's DID, and the
laptop completes the pairing on receipt and shows "verbunden mit X". Add a wire
envelope type for that; `src/wire.ts` is the untrusted-input boundary and
validates strictly, so follow its existing pattern exactly and add tests for
malformed input.

⚠️ Be honest in a code comment about what this costs. A nonce that travels
through the relay is a nonce the relay has seen, so a pair key derived from it
is no longer secret from the relay. That is a genuine weakening compared to the
two-scan ceremony. Options, pick one and say why: derive the key so that only
the QR-borne half is secret, or carry an ephemeral public key rather than a
nonce and do a real key agreement (X25519 is already a dependency via
`src/did.ts`). Do NOT quietly keep calling it end-to-end encrypted if the relay
can derive the key.

## Also

- `apps/mobile-ui/src/screens/meet.js` already builds exactly this kind of
  connect URL (`buildConnectUrl`, `?connect=<did>&relay=<endpoint>&app=<appId>`)
  and `apps/mobile-ui/src/screens/connect_url.js` parses it. **Read both before
  designing anything** and follow their conventions rather than inventing a
  second URL format for the same idea.
- Measure the resulting QR version. A URL with a did:peer:2 in it is long. The
  app's proven-scannable ceiling is version 13; if you exceed it, shorten (a
  short opaque token resolved via the relay is legitimate) and report numbers.
- The laptop's screen must show the pairing completing, live, without a reload.
  The owner's repeated complaint all week is screens that change nothing after
  a successful action.
- Which demos get this: demo 2 (relay) at minimum, since that is the one where
  staying connected means anything.

## Constraints

- Demo 1's build and behaviour stay exactly as they are. `seven_steps.mjs` must
  still pass against a demo-1 build.
- Consent gate, k-anonymity floor and the byte-identical "no answer" are
  unchanged on every path.
- German first in `src/i18n.ts`, plain register, no em dashes.

## Report

`DEVLOG/result-report-one-scan-link.md`: the URL format, the QR version
measured, exactly what the relay can and cannot derive after this change, and
an end-to-end test against the live relay.
