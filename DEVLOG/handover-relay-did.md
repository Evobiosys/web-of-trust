# Handover — browser did:peer:2 + questhub relay channel (mode B)

Worktree: `/Users/personal/Documents/SingularStructure/PROJECTS/evobiosys/evobiosys-PROJECTS/EvoBioSys-cross/PROJECTS/web-of-trust/Code/wt-relay-did`
Branch: `feat/relay-did`. Work ONLY in `apps/demo/`. Do **not** touch `src/main.ts` —
another stream owns it; UI wiring is not your job.

## Goal

Give the demo app a real network path: two already-paired devices exchange the
existing query/answer envelopes through the **live** relay at `questhub.eco`,
end-to-end encrypted so the relay carries ciphertext only.

## What already exists and is verified (do not rebuild)

- The relay is deployed and running: `POST https://questhub.eco/relay/send`
  (ingress, unauthenticated, reads only the outer `to`) and
  `wss://questhub.eco/relay/drain` (egress, WebSocket, Ed25519-authenticated).
- A cold end-to-end probe from a laptop passed today: WS upgrade → server
  `{type:"challenge",nonce}` → client `{type:"auth",did,sig}` →
  `{type:"auth_ok"}` → POST to `/relay/send` → `{type:"wire",id,wire}` arrives
  on the socket in ~106 ms. Ack with `{type:"ack",ids:[...]}` or the wire is
  redelivered on the next connect (at-least-once by design).
- Server-side reference implementation, READ IT, do not import it:
  `packages/transport/src/did_identity.ts` and `src/relay_server.ts`.

## Task 1 — `apps/demo/src/did.ts` (browser-native did:peer:2)

`packages/transport/src/did_identity.ts` uses Node's `Buffer` in six places, so
it cannot be bundled for a browser. Write a browser-native equivalent in the
demo. It must produce DIDs that the SERVER's `resolveDidPeer` accepts byte for
byte — that is the whole contract.

Exports: `createIdentity(serviceEndpoint)`, `signChallenge(identity, nonceB64u)`,
and serialise/deserialise for storing the identity via `db.ts`.

Rules:
- Use `@noble/curves` (ed25519 + x25519) and `@noble/hashes`. Add them as real
  dependencies of `apps/demo/package.json`. Match the versions already in the
  workspace (`@noble/curves@2.2.0`, `@noble/hashes@2.2.0`).
- `apps/demo/src/crypto.ts` already has a Buffer-free base64url implementation.
  Reuse it. Do not add a Buffer polyfill.
- base58btc (multibase `z` prefix) is needed for the key elements. Check what
  `did_identity.ts` imports it from and use the same package if it is
  browser-safe; otherwise implement it (it is ~25 lines) and unit-test it
  against known vectors.

**Acceptance test — this is the gate.** Write
`apps/demo/test/did_interop.test.ts` that imports the demo's `createIdentity`
AND the real `resolveDidPeer` from `packages/transport/src/did_identity.ts`
(a Node test, so `Buffer` is fine there), mints 50 identities, and asserts for
each that `resolveDidPeer` returns the same signing and key-agreement public
keys and the same service endpoint. Also assert that an Ed25519 signature made
by `signChallenge` verifies against `resolveDidPeer(did).signingPublicKey`.
If this does not pass, stop and report — mode B is not viable and we need to
know today.

## Task 2 — `apps/demo/src/relay.ts` (the channel)

A small class or factory with this shape, no UI, no DOM:

- `connect(identity)` — opens `wss://<origin>/relay/drain`, completes the
  challenge/auth handshake, resolves once `auth_ok` arrives, rejects on
  `auth_failed` or timeout. Reconnect with backoff on close; re-auth each time.
- `send(toDid, plaintextEnvelope, pairKey)` — encrypt, then
  `POST /relay/send` with a JSON body whose **outer `to` is the recipient DID in
  cleartext** (the relay routes on it) and whose payload is ciphertext.
- `onEnvelope(cb)` — decrypt inbound wires, hand back a parsed
  `QueryEnvelope`/`AnswerEnvelope` via the existing `decodeFromQr` validator in
  `src/wire.ts`. Ack every wire id after successful handling.

Encryption: AES-GCM via `crypto.subtle` with the pair key the QR ceremony
already derives (`derivePairKey` in `src/crypto.ts`). Fresh random IV per
message, prepended. The relay never saw the QR nonces, so it cannot derive this
key — that is the demo's whole claim and it must be literally true.

**Be precise about what this does NOT prove.** `derivePairKey`'s own header says
it is not an authenticated key exchange: anyone who saw both QR codes can derive
the same key. Your code comments must keep that distinction; do not write
"end-to-end secure" anywhere.

Origin: read it from `location.origin` with a `VITE_RELAY_ORIGIN` override,
defaulting to `https://questhub.eco`. The relay sends **no CORS headers**, so
the page must be served from questhub.eco for this to work at all — say so in a
comment so nobody wastes an hour on it later.

## Task 3 — tests

- Unit-test the wire framing and the encrypt/decrypt round trip (vitest, jsdom).
- `apps/demo/test/e2e/relay_roundtrip.mjs`: a Node script that mints two
  identities, connects both drains to the REAL `wss://questhub.eco/relay/drain`,
  sends a query one way and an answer back, and asserts both arrive decrypted
  and intact. Print timings. Keep it under 20 s.

## Constraints

- `npx tsc --noEmit -p tsconfig.json` and `npx vitest run` must both pass in
  `apps/demo` before you report done. Existing tests (199) must stay green.
- Do not start any long-lived local server. If you need one for a test, kill it
  in the same command.
- Commit on `feat/relay-did` with a descriptive message. Do not merge, do not
  push to any remote.

## Report

Write `DEVLOG/result-report-relay-did.md` in the worktree: what landed, the
did-interop test result (pass/fail with numbers), the measured relay round-trip
time, and anything you could not finish. Then summarise it in your reply.
