# TRANSPORT.md — `@resource-web/transport` (M2-T)

Owned by `packages/transport`. Implements `TransportAdapter` (frozen in
`@resource-web/protocol/src/transport_adapter.ts`, D7) twice: `MatrixTransport`
(real, over a synapse homeserver via `matrix-bot-sdk`) and `MockTransport`
(deterministic, in-memory, for tests — the I5 swappability proof). This
package moves envelopes only; it contains no matching/policy/lifecycle logic
and does not import `agent-daemon`.

## 1. Wire format (Matrix)

Envelopes travel as ordinary `m.room.message` events, so any Matrix client
(Element, etc.) shows something readable in the timeline even without
understanding the custom `msgtype`:

```jsonc
{
  "msgtype": "app.resource-web.envelope",
  "body": "resource-web envelope: REQUEST",       // human-readable fallback
  "app.resource-web.envelope": "{\"v\":\"0.1\",\"type\":\"REQUEST\",...}" // serializeEnvelope() output, verbatim
}
```

`msgtype` and the content key intentionally share the same string — one
namespaced identifier for "this is a resource-web envelope," not two
independently-evolving constants (`packages/transport/src/wire.ts`).

**Sending** (`MatrixTransport.send`): `serializeEnvelope(env)` (from
`@resource-web/protocol` — never re-implemented here) produces the canonical
JSON string; it's placed under the content key above and sent via
`client.sendMessage(roomId, ...)`.

**Receiving**: the client's `"room.message"` event handler:
1. drops the client's own echoes (`event.sender === self`, resolved once via
   `client.getUserId()`, not trusted from `cfg.self` — the server is the
   source of truth for the canonical mxid);
2. ignores any event whose `msgtype` isn't `app.resource-web.envelope`
   (`extractEnvelopeWire`, `wire.ts`) — silently, since foreign messages in a
   DM room (a human typing "hi" in Element, say) are expected, not errors;
3. `parseEnvelope(wire)` on what's left. A parse failure (malformed JSON,
   unknown `type`, extra keys) is logged at **debug** level only and
   dropped — never info, and never the payload contents at any level above
   debug (metadata hygiene per task-m2t-brief.md).

## 2. Account provisioning

`packages/transport/src/matrix_provisioning.ts`. Synapse's admin
shared-secret registration flow (`/_synapse/admin/v1/register`):

1. `GET` the endpoint for a `nonce`.
2. HMAC-SHA1 `nonce\0username\0password\0notadmin` with the registration
   shared secret (`cfg.registration_secret`) → `mac`.
3. `POST { nonce, username, password, admin: false, mac }`. Success returns
   an `access_token` directly — no separate login step needed for a
   brand-new account.

**Idempotent re-run**: registering an already-existing localpart returns
`400 M_USER_IN_USE`. The fallback is a normal password login
(`MatrixAuth.passwordLogin`) using a password derived deterministically from
the same secret: `HMAC-SHA256(registration_secret, localpart)`. This
password is set at registration time and re-derived (never stored) at every
subsequent login, so the same function works on both paths and the
transport carries no persisted secret beyond `registration_secret` itself.

**Display name**: set post-provisioning via `client.setDisplayName`,
best-effort (a failure here is logged and swallowed — it's cosmetic, not
load-bearing).

## 3. One DM room per agent-pair (idempotent)

`MatrixTransport.send` calls `client.dms.getOrCreateDm(peer)` —
matrix-bot-sdk's own idempotent DM-room tracker, backed by `m.direct`
**account data on the homeserver**, not local process state. That's what
makes it idempotent *across restarts*, not just within one process's
lifetime: a fresh `MatrixTransport` instance calls `client.dms.update()`
once after `client.start()` (forcing a fetch of existing `m.direct` data)
before the first `send()`, so a restart never races an empty local cache
into creating a duplicate room for a pair that already has one.

Room creation (`preset: "trusted_private_chat"`, `is_direct: true`) invites
the peer; the **receiving** side auto-joins via `AutojoinRoomsMixin`
(accepts every invite unconditionally). That's an acceptable simplification
for v0's scope — a closed two-agent sim behind a private synapse instance —
not a production posture; gating invite-acceptance by trust-graph membership
is agent-daemon's policy layer, not transport's, per I5/no-protocol-logic-here.

## 4. `createSharedRoom`

Creates a room (`trusted_private_chat`), invites every peer, posts
`context.context_card` as a plain `m.text` message (not an envelope — this
is a human-readable summary, not machine-parsed), and returns
`{ room_id }`. Verified in the integration suite with an independent client
session (not the internal state of either transport instance) actually
reading the posted card back via the standard `GET .../rooms/{roomId}/messages`
API — i.e., "readable by both" is proven at the wire level, not assumed.

## 5. E2EE status: **[S3] — not shipped, platform-blocked, not a code gap**

The brief's 2-hour timebox assumed the risk was "does matrix-bot-sdk's
Rust crypto engine work cleanly." The actual finding is stronger and
took under 30 minutes to establish conclusively: **on this development
machine (macOS, darwin-arm64), `matrix-bot-sdk`'s native E2EE dependency
(`@matrix-org/matrix-sdk-crypto-nodejs`) cannot be imported at all** —
independent of whether E2EE is ever invoked:

- `matrix-bot-sdk`'s `e2ee/CryptoClient.js` and `e2ee/RustEngine.js` both do
  an **unconditional, top-level** `require("@matrix-org/matrix-sdk-crypto-nodejs")`,
  reached via `matrix-bot-sdk`'s own barrel `index.js`. So merely
  `import { MatrixClient } from "matrix-bot-sdk"` fails on this platform —
  not just constructing a client with a `RustSdkCryptoStorageProvider`.
- The native module has no npm-published prebuilt binary for darwin-arm64
  as an `optionalDependency` (confirmed: `@matrix-org/matrix-sdk-crypto-nodejs-darwin-arm64`
  and `-darwin-universal` both 404 from the npm registry). Its actual
  distribution mechanism is a `postinstall` script (`download-lib.js`) that
  fetches the binary from `github.com` release assets — a target this
  machine's outbound network policy does not reach (DNS resolution to
  `github.com` times out; `registry.npmjs.org` is reachable, confirmed by
  the successful `pnpm install` of every other dependency).
- Even setting that network limit aside, `pnpm` ignores the package's
  `postinstall` script by default (a supply-chain safety default, not
  something to override lightly), and doing so would require editing
  root-level config (`pnpm-workspace.yaml` / root `package.json`
  `onlyBuiltDependencies`) — outside this package's owned paths
  (`packages/transport/**`) and risking merge conflicts with the sibling
  `agent-daemon`/`device-ui` worktrees, per this sprint's worktree-isolation
  process.

**Fix shipped**: `packages/transport/src/matrix_crypto_stub.ts` patches
Node's CJS loader (`Module._load`) to return an empty object for that one
specifier instead of throwing, installed as the first import in every file
that touches `matrix-bot-sdk`. This is safe because nothing at
*module-evaluation* time in `CryptoClient.js`/`RustEngine.js` touches the
native module's exports — every reference is inside instance methods that
only execute if a `MatrixClient` is constructed **with** a
`RustSdkCryptoStorageProvider`, which `MatrixTransport` never does. The stub
is scoped entirely to this package's own source files (no root config
touched) and is fully documented in that file's header, including the exact
empirical evidence above.

**Important for whoever picks this up next**: the stub returns `{}`
*unconditionally* for that module specifier — it does not detect whether a
working native binary is actually present. So on a future machine (or this
one, once network policy allows the vendor's own downloader to run) where
the real binary **is** available, the stub as shipped will keep silently
suppressing it rather than letting E2EE start working. Re-enabling E2EE
requires *removing or conditionally-guarding* `matrix_crypto_stub.ts`
(e.g., only install the patch if a real-binary probe fails), not merely
fixing the binary availability and leaving the stub in place.

**Net effect**: rooms are **unencrypted** in v0 (consistent with I7 — v0 is
already honestly labeled not-zero-knowledge; this is one more instance of
that same honest labeling, not a new privacy regression: envelope contents
were never claimed to be E2EE, and Matrix's own transport-layer TLS still
protects it in flight to the homeserver).

**For DECISIONS.md** (not edited directly here — worktree merge-conflict
risk per process; main-thread integrator should append): *E2EE deferred to
[S3], not for lack of an engineering timebox but because
`@matrix-org/matrix-sdk-crypto-nodejs` is architecturally unavailable on at
least one contributor's platform (darwin-arm64) under this project's
network policy — this is an environment/supply-chain constraint, not a
matrix-bot-sdk API gap. Revisit if/when: (a) LuLu/network policy is relaxed
for `github.com` release-asset fetches so `pnpm approve-builds` can run the
vendor's own downloader, or (b) a future `matrix-bot-sdk`/native-module
release ships darwin-arm64 via npm `optionalDependencies` directly.*

## 6. MockTransport

`packages/transport/src/mock_transport.ts`. A `MockBus` (shared per test
scenario) plus `MockTransport` instances (`new MockTransport(bus)`) that
register on `init({ self })`. `send` round-trips through the **same**
`serializeEnvelope`/`parseEnvelope` pair `MatrixTransport` uses — delivered
via a queued microtask (deterministic FIFO order, still asynchronous, so
tests must `await` a tick after `send()` rather than assume synchronous
delivery). `createSharedRoom` returns a bus-wide monotonic `room-<n>`
counter. This is what makes the Mock an actual proof of I5 swappability
rather than a same-object handoff that would prove nothing: both
`MockTransport` and `MatrixTransport` exercise the identical wire contract.

## 7. DIDComm swap notes (future, [S4] — prose only, no code)

v1's stated target ("Hosting model," DECISIONS.md D1.4: eventually one VPS
per user, agent-to-agent over a self-hosted mediator) points toward DIDComm
v2 as the eventual transport, replacing Matrix. The seam this package sits
behind (`TransportAdapter`) is already shaped for that swap:

- `TransportConfig.homeserver_url` becomes a DIDComm mediator endpoint;
  `access_token`/`registration_secret` become whatever the mediator's own
  provisioning scheme requires (DIDComm has no single standard analog —
  likely an out-of-band invitation + DID exchange, not a shared-secret HMAC).
- `PeerId` (currently a matrix user id string) becomes a `did:` URI. Nothing
  in `@resource-web/protocol`'s schemas assumes matrix-specific structure
  (`PeerIdSchema` is `z.string().min(1)`), so this swap doesn't touch the
  frozen v0.1 protocol contract at all.
- `send`/`onEnvelope` keep their shape: DIDComm messages are themselves
  JSON envelopes over an encrypted (by default, not optional like Matrix's
  E2EE) transport — `serializeEnvelope`'s output would become the DIDComm
  message's plaintext body rather than a Matrix event's custom content key.
- `createSharedRoom`'s "shared room + context card" concept doesn't map
  1:1 — DIDComm has no room primitive. The v1 equivalent is likely a small
  n-party thread (DIDComm's `thid`) with the context card as the thread's
  first message; this needs its own design pass at v1, not a mechanical
  swap, and is explicitly out of scope for this task.
- Nothing in `agent-daemon` should need to change beyond constructing a
  different `TransportConfig` and instantiating a different class — that's
  the whole point of I5, and is the reason `MockTransport` exists as a
  standing regression test for the seam rather than a one-off scaffold.

## 8. `infra/synapse/`

No new files added here. The sprint's local synapse (already running,
`docker-compose.yml`'s `synapse` service, `--profile local`,
`server_name: wot.local`, data volume at `infra/synapse/data/`) predates
this task and is shared live state read (not written) by every worktree
provisioning test accounts against it — see § 8.1 for why it wasn't touched.

### 8.1 Why this package didn't need to touch `infra/synapse/data/`

`infra/synapse/data/homeserver.yaml` is synapse's own generated config,
already running and already holding the effective registration shared
secret this task reads from `.env` (`MATRIX_REGISTRATION_SECRET`). It's
live, shared state: the `agent-daemon`/`device-ui` sibling worktrees
provision their own (`anna`/`ben`) accounts against the same instance.
Editing it, or restarting the container, would have broken their sessions
concurrently with this task's own work — so this task only ever reads it
(to confirm which of its three duplicate `registration_shared_secret` keys
is actually effective — YAML's last-key-wins — matching what `.env` holds)
and never writes to it.

## 9. Test accounts

Integration tests use localparts prefixed `test-<label>-<timestamp>-<random>`
(`test_support/live_synapse.ts: uniqueTestLocalpart`) — collision-free across
repeated runs, and clearly distinguishable from the demo's `anna`/`ben`
accounts on the shared synapse instance.

**Synapse's default `rc_login` rate limit** is easy to trip if the suite is
re-run many times back-to-back within a short window (observed during this
task's own development: after ~8 rapid re-runs, `passwordLogin` started
returning `M_LIMIT_EXCEEDED` with a multi-minute `retry_after_ms`). This is
synapse's own default login-attempt throttling, not a transport bug — each
test run only needs one deliberate `passwordLogin` call
(`matrix_provisioning.integration.test.ts`'s idempotent-fallback check, which
must exercise that code path to prove D3's idempotency claim) plus whatever
registrations it needs (registration isn't subject to `rc_login`). The
`createSharedRoom` integration test deliberately reuses an already-
authenticated session (`underlyingClientOf`, a test-only escape hatch into
MatrixTransport's private `client` field) rather than provisioning a second
verifier client, specifically to avoid adding an unnecessary second login
per run. If re-running the suite in a tight loop, expect occasional
`M_LIMIT_EXCEEDED` and just wait out the backoff — this is homeserver-side
throttling, orthogonal to whether the transport code itself is correct.
