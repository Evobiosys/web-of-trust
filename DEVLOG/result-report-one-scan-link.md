# Result report -- scan once, from a link, and stay connected

Worktree: `../wt-onescan`, branch `feat/one-scan-link`, off `08805c5`
(`demo-2026-08-31`). Not pushed anywhere. Work confined to `apps/demo/`,
touching `main.ts` in one localised place per function (imports, `pairKey`,
`screenConnect`, two small new functions) plus one new module,
`connect_link.ts`, that carries almost all of the new logic and every line
of the design reasoning.

## The URL format

```
<origin+path>?connect=<did:peer:2>&id=<personaId>&name=<displayName>
```

Built by `connect_link.ts`'s `buildConnectLinkUrl`, parsed by
`parseConnectLinkParams`. Follows `apps/mobile-ui/src/screens/connect_url.js`'s
`buildConnectUrl` convention (`connect=<did>` param name, `new URL(origin)`
construction, origin+pathname passed in exactly as `meet.js`'s `appBaseUrl`
does) with three deliberate differences, explained in `connect_link.ts`'s
module header:

- no `relay=` -- this app's relay ingress is CORS-locked to same-origin
  (`relay.ts`'s module header), so the scanning device is already on the
  right origin once it has opened the link at all
- no `app=` -- one app id per build (`WOT_BASE`), not mobile-ui's
  shared-origin multi-app case
- an `id=` mobile-ui doesn't need: it is NOT decorative. Every envelope this
  demo sends carries `from.id`, and `main.ts`'s incoming-query handling looks
  the sender up by `s.peers.find(p => p.id === q.from.id)`. Without it, the
  scanning device's Peer record for "whoever showed this QR" would not match
  what that device's own envelopes claim, and every later query from it would
  silently look like it came from an unknown peer -- `blocked: true`, which
  is byte-identical to a real decline (I3). Caught in design, not in testing.

## QR version measured

Same method as `DEVLOG/result-report-webrtc-ladder.md`: the app's own
`qrcode` dependency, `errorCorrectionLevel: 'M'` (`ui/qr.ts`'s exact
setting), against a REAL did:peer:2 from `did.ts`'s `createIdentity`.

| Payload | Bytes | QR version | Modules |
|---|---:|---:|---:|
| Baseline: existing 2-scan JSON connect envelope (already proven scannable in demos 1/2) | 304 | **v13** | 69x69 |
| One-scan connect link, typical name ("Marlene") | 269 | **v12** | 65x65 |
| One-scan connect link, worst-case name ("Björk Müller-Grätzl") | 296 | **v13** | 69x69 |

**The URL comes in at or under the proven-scannable ceiling in every case
measured**, including a longer umlaut-bearing display name. No shortening
scheme (opaque token + relay-side lookup) was needed -- that path was
scoped out once the numbers came back, per the handover's own "if it does
not fit" framing. Reproduce with `did.ts`'s `createIdentity` +
`connect_link.ts`'s `buildConnectLinkUrl` + the `qrcode` package's
`QRCode.create(payload, { errorCorrectionLevel: 'M' })`.

## What the relay can and cannot derive -- the honesty question

**Chosen fix: real X25519 key agreement, not "derive the key so only the
QR-borne half is secret."** Reasoning is written out in full in
`connect_link.ts`'s module header; the short version:

The two-scan ceremony's `derivePairKey` (crypto.ts) is HKDF over two
plaintext nonces exchanged **only between two cameras in the same room**.
A one-scan ceremony breaks that by construction: the phone's half of the
pairing material has no second scan to travel back on, so it has to cross
the network -- through the relay. A nonce the relay carries is a nonce the
relay has seen, and `derivePairKey` from two relay-visible nonces would be
a key the relay could compute too. That would be a straightforward
regression on the existing honesty box (`i18n.ts`'s `relayExplain`), which
already has to admit "anyone who saw both codes could compute the same
key" for the *nonce-based* ceremony -- shipping the SAME weakness for a
ceremony that goes over the open network, and calling it the same "relay
cannot read your traffic" claim, would not be honest.

Instead: `did.ts`'s new `ecdhSharedSecret` (X25519 ECDH between this
device's key-agreement keypair -- already carried on every did:peer:2,
`did.ts`'s `Identity.keyAgreement` -- and the peer's resolved public key)
feeding `crypto.ts`'s new `deriveEcdhPairKey` (the same HKDF-SHA256 step
`derivePairKey` already used, over a different input). **What can travel
over the relay in the clear now: both parties' did:peer:2 strings --
PUBLIC keys, plus a display name.** That is not new exposure: the relay
already sees both DIDs on every wire, cleartext, to route them
(`relay.ts`'s module header, unchanged by this feature). What it still
cannot do is compute `X25519(myPriv, theirPub)` without a PRIVATE
key-agreement key, and neither private key is ever transmitted, printed,
or logged anywhere in this ceremony.

**Precisely stated, and this is the sentence that belongs in any audit of
this feature:**

- The relay can: see both devices' DIDs and know they are pairing (traffic
  metadata, same as always); see the phone's chosen display name (new --
  travels in the `connect-ack`, unencrypted, on purpose, since it carries
  no secret and there is nothing yet to encrypt it with).
- The relay cannot: compute the AES-GCM key either device will use for
  every subsequent query/answer. Proven, not asserted -- see
  `test/connect_link.test.ts`'s "an outsider ... derives a DIFFERENT
  shared secret" and `test/e2e/connect_link_relay.mjs`'s live-relay version
  of the same check.
- Still unauthenticated: if the QR/link itself is tampered with before the
  phone opens it (a swapped DID), the phone pairs with the attacker
  instead -- the same class of caveat the two-scan ceremony already
  carries for "anyone who saw both codes," just moved to a different step.
  Said in the UI, not just in a comment: `i18n.ts`'s new
  `connectLinkHonesty` string, shown as a footnote under every connect-link
  QR.

The new wire envelope this needed: `types.ts`'s `ConnectAckEnvelope`
(`t: 'connect-ack'`), parsed strictly by `wire.ts`'s new `parseConnectAck`
(unit-tested for every malformed shape: missing/empty/wrong-typed `did`,
missing `from`, malformed `from` -- `test/wire.test.ts`). Sent
**unencrypted**, which needed one small, deliberately scoped addition to
`relay.ts`: `sendRaw`/`onRawWire`, a second path alongside the existing
`send`/`onEnvelope`, documented in that file's own header as existing for
exactly this one bootstrap case and nothing else. A wire is still acked
correctly either way (`handleWire`'s logic now checks both sinks).

## The live update

`main.ts`'s `showConnectLinkCode()` deliberately never calls `go()` --
`screen` stays `'connect'` the whole time the link/QR is on screen, exactly
matching `showMyConnectCode()`'s existing convention. `handleRawWire` (the
new `onRawWire` sink) re-renders with a plain `if (screen === 'connect')
render()` the moment a valid `connect-ack` arrives, which redraws
`screenConnect()` in place and now shows "Verbunden mit Nora"
(`peerStatusLine`, unchanged, already handles this) instead of the QR.
No polling, no new screen state, no reload. Verified live against the real
relay below.

## Tests

- `npx tsc --noEmit`: clean.
- `npx vitest run`: **279 passed** (258 baseline + 10 new `wire.test.ts`
  cases for `ConnectAckEnvelope` + 11 new `test/connect_link.test.ts` cases
  -- URL round-trip incl. umlauts/punctuation, `buildConnectAck`, and the
  ECDH key-agreement proofs: same secret both directions, the derived key
  actually decrypts across devices, a third identity with only public DIDs
  derives a provably different secret, different peer pairs derive
  different secrets).
- **`npx tsx test/e2e/connect_link_relay.mjs`, against the LIVE relay at
  questhub.eco: 13/13 assertions passed.** Mints two real did:peer:2
  identities ("laptop", "phone") plus a third ("outsider"), connects both
  drains for real, sends a real unencrypted `connect-ack` via `sendRaw`,
  receives it via `onRawWire`, confirms both sides derive the identical
  ECDH key while the outsider (limited to the same public DIDs the relay
  itself sees) derives a different one, then runs a full
  `gate.decide`/`gate.interpret` query-and-share round trip over that key --
  the actual downstream payoff of pairing this way, not just the bootstrap
  message. Re-run twice (860ms and 967ms total wall time); green both
  times.
- `npx tsx test/e2e/relay_query_answer.mjs` and `relay_roundtrip.mjs`
  (pre-existing, untouched by this feature): re-run for regression, both
  still green against the live relay.
- **Demo 1 regression, against demo 1's actual build**, not the dev server:
  `WOT_BASE=/wot-demo/ npx vite build`, served statically (matches this
  repo's own established precedent in
  `DEVLOG/result-report-demo2-relay-ui.md`: `vite preview` 404s assets
  under headless Chromium for the same base-path reason noted there).
  `test/e2e/seven_steps.mjs` against it: **all 24 checks passed**,
  including the byte-identity proofs. Demo 1's build and behaviour are
  untouched by this feature -- every new code path in `main.ts` is gated on
  `wotMode() === 'relay'`.
- **Manual, uncommitted browser smoke of the actual UI**, two real Chromium
  contexts (a 1200x900 "laptop" and a 390x844 "phone"), against the LIVE
  relay via a throwaway local same-origin proxy (matches this repo's own
  established precedent -- `result-report-demo2-relay-ui.md`'s identical
  "a local /relay dev-proxy config would need to be documented" note; not
  committed here either, same reasoning: relay.ts's `send`/`sendRaw` are
  CORS-locked to same-origin, so a browser-driven version of this test
  needs a page actually served from questhub.eco to run without a proxy).
  Walked the FULL real flow:
  1. "Marlene" (laptop) opens the demo, taps Verbinden -> Verbindungslink
     zeigen. QR/link produced, carrying `connect=`, `id=marlene0`,
     `name=Marlene`.
  2. "Nora" (phone context) navigates DIRECTLY to that URL -- no QR
     decoding involved, simulating exactly what a camera's "open link"
     action does. Lands on the persona picker (fresh device, no state
     yet), picks Nora.
  3. Both devices reach "Verbunden mit ..." within ~1-2s, **live, with
     Marlene's screen never having left the connect-link view** -- no
     reload, no manual navigation on her side at all.
  4. Nora asks the real housing question over the relay
     ("Frage unterwegs..."); Marlene's screen auto-navigates to the
     consent ceremony the instant it arrives ("Nora fragt", a real match
     found), over the ECDH-derived key -- proving `pairKey()`'s new
     branch works for the entire downstream protocol, not just pairing.
     Tapped "Ja, teilen"; Nora received "Geteilt" with the real flat
     message. Zero uncaught page errors on either device throughout.

## Not finished / left for the demo owner

- No automated browser e2e for the one-scan link is committed, for the
  same reason demo 2's original relay wiring has none: it needs
  `PLAYWRIGHT_PACKAGE` plus a local `/relay` (HTTP **and** WS) dev-proxy
  documented as a repeatable setup, which this repo deliberately avoids
  taking on as a dependency. The Node-level `connect_link_relay.mjs`
  (committed) is the repeatable, CI-safe proof of the same mechanism; the
  manual browser walk above is the uncommitted confirmation that the UI
  actually wires it up correctly.
- The `connect-ack`'s display name travels unencrypted over the relay (see
  the honesty section above) -- a deliberate, documented tradeoff, not an
  oversight, but worth the owner knowing explicitly: a relay operator can
  now see a chosen nickname during pairing that it could not see before
  this feature. Nothing else new is exposed.
- Only relay mode (demo 2) got the one-scan link, per the handover's "at
  minimum." Webrtc/ladder modes (demo 3/6) keep their existing two-scan
  ceremony unchanged; extending the same link-based approach there was out
  of scope and not attempted.
