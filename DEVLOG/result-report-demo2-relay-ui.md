# Result report -- demo 2: wire the relay into the UI

Worktree: `../wt-demo2`, branch `feat/demo2-relay`, off `demo-2026-08-31` at
`4c8cc6c`. Not pushed anywhere. Work confined to `apps/demo/`.

## Gate: transport proven before any UI code

`npx tsx test/e2e/relay_roundtrip.mjs` against the live relay at
`questhub.eco`, before touching anything: **all assertions passed**
(connect 645-1300ms, query/answer round trips 90-120ms). Re-ran it again
after all changes: still green. Transport was never in question; everything
below builds on it.

## What landed

**Build-time mode** (`src/mode.ts`): `wotMode()` reads
`import.meta.env.VITE_WOT_MODE`, defaults to `'qr'`. No `vite.config.ts`
change needed (same mechanism `VITE_RELAY_ORIGIN` already used).

**Identity** (`src/relay_identity.ts`, `did.ts`'s `SerializedIdentityV1`
exported, `state.ts`'s `DeviceState.relayIdentity`): a did:peer:2 is minted
lazily, once, in relay mode only, and persisted through the existing
`saveState`/`loadState` -- reused across reloads, ephemeral when storage is
blocked, exactly per the handover.

**DID through pairing** (`types.ts`, `wire.ts`): `ConnectEnvelope.did` is
optional. `decodeFromQr` still parses a demo-1 code with no `did` key at
all; a present-but-malformed `did` (wrong type, empty string, absent
entirely-vs-present) rejects the whole envelope, matching every other
field's strictness. Wire tests added for all three cases (present/valid,
absent, present-and-malformed across five bad types).

**QR growth, measured**: connect payload 104 -> 311 chars; QR version
(ECC level M) 6 -> 13. Comfortably under the version-15 alarm the handover
set.

**Transport switch** (`main.ts`): in relay mode, `askWith()`/`emitAnswer()`
send over the relay when the peer's DID is known; the QR path is unchanged
code, reachable via an explicit "Code stattdessen zeigen" button on every
relay screen, or automatically as the fallback when a relay send fails
outright. **Seeded pairing has no peer DID and this is a precondition, not
an error** -- a did:peer:2 is minted fresh, at random, per device, per boot,
so it cannot be pre-seeded the way the demo nonces are; the ask/answer
screens say so plainly (`relayNoPeerDid`) and route to Connect rather than
treating it as a failure.

**"Say what is happening"**: a live connection status line
(verbindet/verbunden/getrennt + "seit HH:MM:SS", `relay.ts`'s new
`onStatus()` callback -- `connect()`'s own promise only ever reports the
FIRST attempt, so a silent reconnect after a drop would otherwise never
reach the UI); a visible "Frage unterwegs" while a query is in flight; a
20s hard timeout with a real error message and a Retry button, never a
bare spinner. The status badge updates by direct DOM mutation, never by
calling `render()` from a background event -- that would tear down an
active camera stream or QR wake lock.

**Privacy invariants over the relay**: `gate.ts` is untouched. The
transport choice in `emitAnswer()` is made strictly from "do we know a
network address for this peer", never from `outcome`/`consent` -- branching
there would reopen exactly the side channel the byte-padding exists to
close. Re-registered `onEnvelope` after a real connect ceremony (a fresh
ceremony overwrites the pair-key nonces; `relay.ts` keeps only one sink
registration, so a stale key would silently drop every inbound wire and
never ack it -- caught in review before it shipped, not in testing).

New wire-level test (`relay.test.ts`): drives all five `decide()` outcomes
(shared/declined/below-k/no-match/blocked) for one fixed question through
`encryptEnvelope` exactly as `relay.ts`'s `send()` does, and asserts the
OuterWire payload length -- what the relay actually observes -- is
identical across all five. The exact ciphertext bytes are deliberately
NEVER identical between two sends (a fresh random AES-GCM IV per call,
correctly -- reusing an IV under one key would be a real confidentiality
break), so length is the provable invariant, not byte-identity, at this
layer.

**What is not fully closed, named rather than hidden**: `gate.ts`'s own
`settleAt` comment already says it cannot remove *human* deliberation time.
Over QR that gap was invisible to any third party. Over the relay it
becomes an inter-arrival delta (query received -> answer sent) the relay
operator can observe, and the no-match path's UI (`Weiter`, one tap) is
faster than the has-match path's (`Zeigen, was geteilt würde` then
yes/no). This is a metadata surface that exists because the transport
left sneakernet, not a weakened invariant -- the byte-level "no answer"
still holds. The German copy (`relayExplain`, on the Connect screen) says
so in three clauses: the relay cannot read the content; it does see who
talks to whom and when; and the pairing itself is not an authenticated
exchange, so anyone who saw both connect codes could compute the same key.
A fixed answer-send offset from query receipt would close the timing gap
further -- flagged as a decision for the demo owner, not built silently.

## Tests

- `npx vitest run`: **242 passed** (235 baseline + 3 `wire.test.ts` + 1
  `relay.test.ts` + 3 new `mode.test.ts`). `npx tsc --noEmit` clean.
- `npx tsx test/e2e/relay_roundtrip.mjs`: green, before and after.
- New `test/e2e/relay_query_answer.mjs`: drives the full
  query -> gate.decide -> relay -> gate.interpret chain against the live
  relay, once sharing and once declining the same question, and re-proves
  the wire-length invariant against envelopes that actually crossed the
  live relay (not just synthetic local data). All assertions passed.
- **Demo 1 regression, against demo 1's actual build** (not the dev
  server): `WOT_BASE=/wot/demo1/ npx vite build`, served statically (not
  `vite preview` -- that 404'd assets under headless Chromium for reasons
  not fully diagnosed; a plain static file server at the matching base
  path worked cleanly), `test/e2e/seven_steps.mjs` run against it: **all 24
  checks passed**, including the byte-identity proofs.
- Manual browser smoke of demo 2's actual UI (not part of the committed
  suite -- a one-off verification pass, Playwright driven, real paste-based
  connect ceremony both directions, then Nora asks and Marlene answers with
  zero manual scanning): Nora's ask screen showed "Frage unterwegs" with no
  QR rendered; Marlene auto-navigated into the consent ceremony the moment
  the query arrived; Marlene's answer screen showed "Antwort gesendet"
  with no QR; Nora received "Geteilt" with the real flat message
  automatically. No uncaught page errors on either device. This is the
  actual demo pitch, working, over the real relay, through the real UI.

## Not finished / left for the demo owner

- The fixed answer-send offset (I3's uniform reply schedule) is not
  implemented for the relay path -- see the named residual above.
- No automated browser e2e for relay mode is committed (the manual smoke
  test proved the flow but needs Playwright as an installed dependency,
  which the codebase deliberately avoids; `PLAYWRIGHT_PACKAGE` plus a local
  `/relay` dev-proxy config would need to be documented if this should
  become a committed, repeatable check).
- Marlene's screen auto-navigates to the consent ceremony (`go('answer')`)
  the instant a query arrives, regardless of what she is doing -- correct
  for the demo's "it just works" moment, but if she happens to be mid a
  QR/camera scan on some OTHER screen at that exact instant, the DOM
  teardown does not explicitly stop her camera stream first (a pre-existing
  class of risk in this codebase, not introduced here, but now reachable
  from a background event instead of only a user tap).
