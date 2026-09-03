# Handover — demo 2: wire the relay into the UI

Worktree: create your own from `/Users/personal/.../Code/primary-repo` on branch
`feat/demo2-relay` (`git worktree add ../wt-demo2 -b feat/demo2-relay`).
Work only in `apps/demo/`. Commit locally. **Do not push to any remote** — the
repo now has an explicit no-push rule in `CLAUDE.md`; read it.

## What exists already (do not rebuild any of it)

- `apps/demo/src/did.ts` — browser-native did:peer:2. Proven byte-compatible
  with the server's real `resolveDidPeer` by `test/did_interop.test.ts`.
- `apps/demo/src/relay.ts` — `createRelayChannel()` with `connect`,
  `send(toDid, envelope, pairKey)`, `onEnvelope(pairKey, cb)`, `close`.
  AES-GCM under the QR-derived pair key; the relay carries ciphertext only.
  ⚠️ Two contracts its author flagged: `onEnvelope` takes the pair key as its
  FIRST argument, and it must be registered **before** `connect()` or a wire
  arriving in the gap is lost.
- `test/e2e/relay_roundtrip.mjs` — round-trips both envelope types through the
  live relay. Run it first so you have seen the transport work before you touch
  any UI.
- The relay is reachable **same-origin** at `/relay/send` and `/relay/drain`
  when the page is served from `app.idea2.site`. It sends no CORS headers, so
  cross-origin will not work; `relay.ts` already defaults sensibly, read it.

## The demo this has to produce

Demo 1 (QR only) stays exactly as it is. Demo 2 is the same app with one thing
different: after the two devices are paired, **the question and the answer
travel over the network instead of over QR codes**. Nora asks, and the answer
appears on her phone by itself. That is the moment; everything else is
plumbing.

Ship it as a **build-time mode**, not a runtime toggle:

```
VITE_WOT_MODE=relay WOT_BASE=/wot/demo2/ npx vite build
```

Default `qr`, so demo 1's build is unchanged. A demo URL that does one thing is
worth more in a live room than a settings screen, and it keeps demo 1's
verified behaviour untouchable.

## Work

1. **Identity.** Mint a did:peer:2 per device on persona seed, store it in
   `DeviceState` via the existing store, reuse it across reloads. Note
   `storageIsEphemeral()`: on a phone with blocked storage the identity is
   per-visit, which is fine, but do not assume persistence.

2. **Carry the DID through pairing.** `ConnectEnvelope` needs the sender's DID
   so the other side can address it. `src/wire.ts` is the untrusted-input
   boundary and validates strictly — extend it properly: the field is OPTIONAL
   so a demo-1 code still parses, and `decodeFromQr` must still never throw on
   anything malformed. Add wire tests for: DID present, DID absent, DID
   present but malformed.
   ⚠️ This grows the connect QR. Measure the payload length and the resulting
   QR version before and after, and put the numbers in your report. If it
   pushes the code past version ~15 say so — dense codes are the thing that
   fails in a room.

3. **Transport switch.** In relay mode, sending a query or an answer goes
   through the relay instead of rendering a QR; receiving happens on the drain.
   Keep the QR path in the code and reachable as a fallback (the runbook's
   "when a step fails" section depends on a paste/QR escape hatch existing).

4. **Say what is happening.** The user has been explicit that silent screens
   are the worst failure mode: a scan that closed silently read as a crash.
   So: a visible connection state (verbindet / verbunden / getrennt, mit
   Zeitpunkt), a visible "Frage unterwegs" while in flight, and a real error
   message with a retry when the relay is unreachable. Never a spinner that
   can hang forever — put a timeout on it and say what happened.

5. **Keep every privacy invariant.** The gate, the k-anonymity floor and the
   byte-identical "no answer" apply unchanged over the relay. The answer
   payload must stay byte-identical between decline, below-k and no-match —
   now with the additional requirement that this holds for what the RELAY
   sees, not just what the peer sees. Add a test that asserts it at the wire
   level.

6. **Be exact about the claim.** The relay cannot read the payload: the key
   comes from nonces exchanged in the room, which the relay never saw. It does
   see who is talking to whom, and when. Write that in the UI copy, in German,
   plainly. Do not write "Ende-zu-Ende-verschlüsselt" without saying what it
   does not cover — `derivePairKey`'s own header says it is not an
   authenticated key exchange.

## Tests

- Unit tests for the wire change and the mode switch.
- Extend `test/e2e/relay_roundtrip.mjs`, or add a sibling, that drives the real
  two-device flow through the live relay and asserts the answer arrives.
- The existing 235 tests must stay green, and `test/e2e/seven_steps.mjs` must
  still pass against demo 1's build. If you break either, fix the cause.

## German copy

Read a dozen existing strings in `src/i18n.ts` first and match the register:
plain, unfussy, no marketing. Every user-facing string goes in `i18n.ts` in
both languages. No em dashes in user-facing copy.

## Report

`DEVLOG/result-report-demo2-relay.md` in your worktree: what landed, the QR
payload/version measurements from step 2, the e2e output, test counts before
and after, and anything you could not finish. Summarise in your reply.
