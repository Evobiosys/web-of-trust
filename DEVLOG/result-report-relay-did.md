# Result report — browser did:peer:2 + questhub relay channel (mode B)

Worktree: `wt-relay-did`, branch `feat/relay-did`. Scope respected: only
`apps/demo/` (plus root `pnpm-lock.yaml`, unavoidable when adding
dependencies to a pnpm workspace member) was touched. `apps/demo/src/main.ts`
was not touched.

## Task 1 — THE GATE: PASSED

`apps/demo/test/did_interop.test.ts` imports the demo's `createIdentity`
(`apps/demo/src/did.ts`) side by side with the REAL, Node-only
`resolveDidPeer` from `packages/transport/src/did_identity.ts`:

- 50 demo-minted identities resolved by the server's real `resolveDidPeer`:
  signing public key, key-agreement public key, and service endpoint all
  matched byte-for-byte, for all 50.
- 50 `signChallenge` signatures verified against
  `resolveDidPeer(did).signingPublicKey` via `@noble/curves`' `ed25519.verify`,
  for all 50.
- A negative control (sign with the wrong identity's key) correctly failed to
  verify — proves the above isn't vacuously true.

All 3 tests pass. `apps/demo/src/did.ts` is a from-scratch, browser-safe
reimplementation of `did_identity.ts`'s did:peer:2 algorithm (same multicodec
prefixes, same V/E/S element order/encoding), built on `@noble/curves`
(ed25519 + x25519), `multiformats/bases/base58` (same package
`did_identity.ts` uses; its base-x implementation is pure `Uint8Array` code,
no Node builtins), and `crypto.ts`'s existing Buffer-free base64url — no
Buffer polyfill added.

**Independent confirmation this reuse decision is sound**: an earlier,
unrelated stream in this repo (`packages/browser-agent/src/identity.ts`) made
the identical reuse decision for the identical reason (documented in that
file's own header) and its `relay_client.test.ts` already proves
browser-minted DIDs interoperate with `packages/transport` bidirectionally.
`did.ts` does not import that package (per the handover: "no coupling"
between `apps/demo/` and sibling apps) but mirrors its proven approach.

**Bundle-safety check beyond tsc/vitest**: built `did.ts` + `relay.ts` through
a standalone `vite build` (browser target, no test harness) and grepped the
output for `Buffer`/`node:` references — none found. Loaded the resulting
ES module bundle in plain Node with only `globalThis.window = globalThis` set
(no other browser shim) and successfully minted an identity and signed a
challenge through it, confirming the code that will actually ship to a
browser runs correctly, not just that Vite's dev build didn't complain (the
normal `apps/demo` build tree-shakes `did.ts`/`relay.ts` out entirely right
now, since nothing imports them yet — see below).

## Task 2 — `apps/demo/src/relay.ts`: DONE

`createRelayChannel(opts)` returns `{ connect, send, onEnvelope, close }`.

- `connect(identity)` — opens `wss://<origin>/relay/drain`, runs the
  nonce → Ed25519-sign → `auth_ok` handshake, resolves on `auth_ok`, rejects
  on `auth_failed` / socket-closed-before-auth / a 10s timeout. A
  capped-exponential-backoff reconnect loop (1s → 15s ceiling) then runs in
  the background indefinitely (re-authenticating from scratch every attempt)
  until `close()`, regardless of whether the FIRST `connect()` call
  succeeded or rejected — the rejection is purely fast feedback for the
  first caller, not a statement that the channel gave up.
- `send(toDid, envelope, pairKey)` — AES-GCM-encrypts (fresh random IV per
  call, prepended to the ciphertext, single base64url `payload` field), then
  `POST /relay/send` with `{to, from, payload}` — `to` is the cleartext
  recipient DID (the relay's sole routing key, per `relay_server.ts`'s file
  header); `from` (sender DID, cleartext) is included too — informational
  only, not read by the relay, and not a new leak (`to` is already cleartext
  on the same wire, and the two devices already exchanged DIDs during
  pairing).
- `onEnvelope(pairKey, cb)` — decrypts inbound wires with `pairKey`,
  validates with `wire.ts`'s `decodeFromQr`, hands the result to `cb`, acks
  only on success (a decrypt/parse failure is neither acked nor delivered).

**Deviation from the handover's literal signature, stated explicitly for the
`main.ts` stream**: the brief specified `onEnvelope(cb)`. That signature
cannot decrypt anything — the channel has no peer directory of its own to
look up a pair key from a sender DID, and `send()` already takes `pairKey`
explicitly per call for the same reason (no peer directory). I added
`pairKey` as `onEnvelope`'s first argument, symmetric with `send`'s. This
means: **one active `(pairKey, cb)` registration per channel**, matching the
demo's actual scope (one asker, one holder, one pairing at a time) — a
multi-peer version would need either a resolver callback or one channel
instance per peer, both out of scope here. If `main.ts` needs multiple
concurrent peers, flag it back rather than silently working around this.

**Second thing `main.ts` needs to know**: **call `onEnvelope` before
`connect()`.** A wire that arrives while no sink is registered is dropped
without being acked, exactly like a decrypt failure — but the "the relay
redelivers it later" recovery documented in `relay_server.ts`'s file header
only fires on a NEW connection (its `flush()` skips ids already pushed to
the live socket's `sentPending` set). A channel that connects cleanly and
never drops can go the entire session without another reconnect, so a wire
that lands in the gap between `connect()` and a late `onEnvelope()` call can
be lost for the life of that connection, not merely delayed. This is called
out directly in `onEnvelope`'s doc comment in `relay.ts`.

Encryption: `crypto.subtle` AES-GCM via the existing `derivePairKey` output
(no new crypto primitive introduced). The module header repeats
`crypto.ts`'s own SECURITY NOTE and explicitly instructs future readers not
to describe this as secure end to end.

CORS: documented precisely — only `POST /relay/send` is CORS-blocked from a
foreign origin (`resolveRelayOrigin()`'s doc comment and the module header).
The `wss://.../relay/drain` handshake is NOT subject to CORS (the
same-origin/CORS model doesn't apply to the WebSocket protocol), so the
drain half of this module works cross-origin regardless — only `send()`'s
ingress POST requires the page to be served from questhub.eco. Origin
resolution order: explicit `opts.relayOrigin` (tests/scripts) →
`VITE_RELAY_ORIGIN` (build-time override) → `location.origin` (correct once
deployed to questhub.eco) → hardcoded `https://questhub.eco` fallback (for
contexts with no `location`, e.g. the Node e2e script).

## Task 3 — tests: DONE

- `apps/demo/test/relay.test.ts` — 18 tests, pure/no network: outer-wire
  framing round trip + 8 malformed-input rejections; encrypt/decrypt round
  trip for both `QueryEnvelope` and `AnswerEnvelope`; fresh IV per call;
  wrong-pair-key failure; tampered-ciphertext (AEAD) failure; too-short
  payload; garbage base64url; and "authenticates but isn't a recognised
  envelope" (AEAD passes, `decodeFromQr` rejects) — all return `null`, never
  throw.
- `apps/demo/test/e2e/relay_roundtrip.mjs` — real round trip against the LIVE
  `questhub.eco` relay (no mock, no local server). Run via
  `npx tsx test/e2e/relay_roundtrip.mjs` from `apps/demo/` (playwright is
  correctly not a dependency here; this script needs no browser — Node ≥ 22's
  native `WebSocket`/`fetch` plus `crypto.subtle` are enough, and `tsx` is
  already a root devDependency used the same way by `Makefile`'s
  `scripts/*.ts` targets).

  **Three separate live runs, this session, all passed:**

  | run | connect (both drains) | query Nora→Marlene | answer Marlene→Nora | total |
  |---|---|---|---|---|
  | 1 | 1180 ms | 107 ms | 227 ms | 1549 ms |
  | 2 | 578 ms | 129 ms | 84 ms | 825 ms |
  | 3 (after doc-only edits) | 702 ms | 269 ms | 92 ms | 1097 ms |

  All well under the 20s budget. Each run: mints two fresh did:peer:2
  identities, authenticates both drains, sends a `QueryEnvelope` one way and
  an `AnswerEnvelope` the other, asserts both arrive decrypted and
  byte-identical (`JSON.stringify` equality) to what was sent, and asserts
  correct DID attribution on both deliveries.

## Constraints

- `npx tsc --noEmit -p tsconfig.json`: clean, in `apps/demo`.
- `npx vitest run`, `apps/demo`: **220 passed** (199 pre-existing + 3
  `did_interop.test.ts` + 18 `relay.test.ts`). Zero regressions.
- No long-lived local server was started at any point; the e2e script talks
  outbound only to the already-live `questhub.eco` relay.
- Committed on `feat/relay-did`. Not merged, not pushed.

## Dependencies added (`apps/demo/package.json`)

- `@noble/curves@2.2.0`, `multiformats@^14.0.4` — used directly by `did.ts`.
- `@noble/hashes@2.2.0` — added per the handover's explicit instruction and
  to match the pinned version used elsewhere in the workspace; **not
  currently imported directly** by anything in `apps/demo` (it's already a
  transitive dependency of `@noble/curves`, which uses it internally for
  Ed25519/X25519's hashing). Flagging so it isn't mistaken for dead code by a
  future cleanup pass — remove it then if it's still unused.
- `@resource-web/transport` (devDependency, `workspace:*`) — used only by
  `did_interop.test.ts`, imported by relative path
  (`../../../packages/transport/src/did_identity`) rather than the package
  specifier, so the gate test needs no pre-build step of that package's
  `dist/`.

**`pnpm-lock.yaml` note**: the diff also contains two unrelated entries
(`apps/mobile-ui`'s `@resource-web/agent-daemon` moving from `devDependencies`
to `dependencies`, and a `vitest`/`vite` resolution-string change under
`packages/agent-daemon`). Verified these are **pre-existing lockfile drift**,
not introduced by this work: reproduced by stashing every change from this
session and running a clean `pnpm install` against the untouched branch —
the identical two entries changed. Not something this task caused or fixed.

## What was NOT done (explicitly out of scope, per the handover)

- No wiring into `main.ts` (owned by another stream).
- No multi-peer support in `relay.ts` (see the `onEnvelope(pairKey, cb)`
  deviation note above) — flag back if needed.
- IndexedDB persistence for a minted identity (`db.ts` integration) was
  scoped by the handover as "serialise/deserialise for storing the identity
  via db.ts" — `did.ts` exports `serializeIdentity`/`deserializeIdentity`
  (deterministic, base64url secret keys, versioned record shape) ready for a
  caller to pass to `kvSet`/`kvGet`, but no caller wires that up yet (that's
  `main.ts`'s job).
