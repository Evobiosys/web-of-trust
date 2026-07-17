# DAEMON.md — agent-daemon (M2-A)

`packages/agent-daemon` is one persona's whole agent: SQLite stores, policy
engine, matcher chain, request lifecycle (asker + owner sides), steward chat,
and the REST/WS surface for `apps/device-ui`. One codebase, N persona
configs (`PERSONA_NAME`, `PEER_ID`, `AGENT_PORT`, ... — see the config table
in `docs/API.md`, reproduced at the end of this file with agent-daemon-side
notes). This document covers architecture, the two lifecycle diagrams, the
I3 decline-silence subtlety in detail, and every place this package made a
documented interpretation call rather than silently guessing.

## Architecture

```
                         ┌─────────────────────────────┐
apps/device-ui  <──REST/WS──▶  api/server.ts (127.0.0.1) │
                         │             │                 │
                         │             ▼                 │
                         │      daemon/daemon.ts          │
                         │  (owner lifecycle, asker        │
                         │   lifecycle, steward, rooms)    │
                         │      │      │      │            │
                         │      ▼      ▼      ▼            │
                         │  store/  matcher/  audit/        │
                         │ (SQLite) (embed→LLM→keyword)      │
                         └─────────────┬───────────────────┘
                                       │ TransportAdapter (protocol)
                                       ▼
                          transport/in_memory_transport.ts
                       (mock; @resource-web/transport at merge)
```

- `store/` — `Store` interface + `SqliteStore` (better-sqlite3, falling
  back to `node:sqlite` — D6). Tables: `items`, `item_embeddings`,
  `trust_edges`, `asks`, `incoming`, `rooms`, `room_messages`,
  `steward_log`, `pending_capture`, `audit_log`.
- `matcher/` — the 3-stage chain (embedding shortlist → LLM adjudication →
  keyword/synonym fallback), `test-fixtures/embeddings.json` (real ollama
  recording), `scripts/record_embeddings.ts` to refresh it.
- `daemon/daemon.ts` — the one class where lifecycle state actually
  changes. `envelopes.ts` is the only place wire `Envelope`s are built.
- `api/` — REST/WS server (`server.ts`) + the I2 sanitizer (`sanitize.ts`,
  `types.ts`) that is the *only* place asker-facing views get built.
- `steward/` — natural-language intent classification + capture/confirm.
- `audit/audit.ts` — `logOwner` (unrestricted, I4) vs `logAsker` (refuses to
  persist a peer id or the word PENDING — I2, checked at write time, not
  scrubbed after the fact).
- `clock.ts` — `Clock`/`Scheduler` seam: `SystemClock`/`RealScheduler` in
  production, `FakeClock`/`FakeScheduler` in tests (`advance(ms)` fires every
  due task, in (time, insertion-order) order, awaiting async task fns).

## Owner-side lifecycle (I3 core)

```
REQUEST received
      │
      ▼
evaluatePolicy(item, request, edge, now)  for every item  ──▶ eligible items
      │
      ▼
matchRequestToItems(text, eligibleItems)  (embedding → LLM → keyword)
      │
   ┌──┴───────────────┐
   │ no match          │ matched item
   ▼                   ▼
schedule PASS      create IncomingRecord (consent card)
at statusDispatchAt   state = "pending" (ask_each_time)
(receivedAt, delay)      or "consented" (auto_forward, audit-logged now)
                      schedule dispatchOwnerStatus(cardId)
                      at the SAME statusDispatchAt(receivedAt, delay)
                       │
                       ▼
      ══════════ uniform delay elapses (fire time) ══════════
                       │
      card.state at THIS moment, not when scheduled:
        "declined" / "inactive"  ──▶ send STATUS(PASS)   [byte-identical to no-match PASS]
        "pending" / "consented"  ──▶ send STATUS(PENDING)
                                      then, if already "consented": completeConsent()
                                      (create room, send CONSENT, send INTRO)
```

Two independent, later events:
- `POST /api/consent` (before or after dispatch) → `card.state = "consented"`;
  if the uniform STATUS already went out, `completeConsent()` runs
  immediately; otherwise the scheduled `dispatchOwnerStatus` callback will
  see `"consented"` when it fires and complete it itself.
- `POST /api/decline` (before or after dispatch) → `card.state = "declined"`;
  if not yet dispatched, the fire-time handler sends PASS; **if already
  dispatched, decline sends nothing further at all.**

## I3 — the decline-silence subtlety, precisely

There are exactly two distinguishable moments for a decline, and the wire
behaviour differs on purpose:

1. **Decline before dispatch.** The owner taps No before the uniform delay
   elapses. At fire time, `dispatchOwnerStatus` reads `card.state ===
   "declined"` and sends `STATUS(PASS)`. This is **byte-identical** (same
   envelope shape: `{v, type: "STATUS", request_id, ts, body: {state:
   "PASS"}}`, same `serializeEnvelope` output for the same request_id/ts) to
   the "no eligible item matched" PASS — verified directly in
   `daemon/daemon.test.ts` ("I3 indistinguishable No"), which builds both
   scenarios under the same fake clock/request_id and asserts equal
   serialization.
2. **Decline after dispatch.** The owner taps No after `STATUS(PENDING)` has
   already gone out. `decline()` flips `card.state` to `"declined"` and
   **sends nothing else** — no correction, no second STATUS, nothing. The
   asker's aggregate stays `"waiting"` until its own ask TTL elapses, at
   which point it resolves to `"no_one_this_time"` — indistinguishable, from
   the asker's side, from "nobody ever had it" or "nobody ever decided."

The second case exposed a real gap in the frozen protocol package: its
asker state machine (`state-machine.ts`) has **no transition from
`"pending"` to any terminal "no" state** — only `CONSENT` (→ `"consented"`)
or `WITHDRAW` (→ `"withdrawn"`) are valid from `"pending"`. There is no
`"pending" → "pass"` event. Rather than invent an event the protocol package
doesn't define, this is resolved **at the view layer only**
(`api/sanitize.ts`'s `askerStateToApi`): the stored `internal_state` honestly
stays `"pending"` forever (nothing false is ever persisted), but once `now`
is past `created_at + ttl_ms` with no CONSENT ever received, the
API-exposed state degrades to `"no_one_this_time"`. This is squarely in I3's
spirit — a silent, graceful timeout — and is exactly what the M2 brief's
demo story (5b) describes ("Anna sees 'no one this time' only after TTL").
Flagged here explicitly since it's an interpretation call, not something the
frozen state machine spells out.

## Asker-side lifecycle (I2 core)

```
sendAsk(text)
  → REQUEST fanned out to every non-expired trust edge
  → per-peer internal state: "queried"
  → on each STATUS(PASS|PENDING): peer state -> "pass" | "pending"
  → once every peer has replied (or the ask's own TTL fires while still
    "open"): STATUS_ALL_IN(anyPending) -> internal "pending" | "pass"
  → on CONSENT (may arrive well after all STATUS, when the owner decides):
    internal "pending" -> "consented"
  → on INTRO: internal "consented" -> "room", room_id recorded
```

`api/sanitize.ts`'s `askerStateToApi` is the **only** function that turns
internal state into the API's `asks[].state` enum
(`open|waiting|someone_can_help|no_one_this_time|room_open|withdrawn`). The
load-bearing line: internal `"pending"` → API `"waiting"` — a PENDING on the
wire never promotes the asker's view past "waiting"; only a CONSENT envelope
(a structurally distinct message) does that. `/api/audit`'s asker-facing
entries are written through `audit/audit.ts`'s `logAsker`, which **refuses
at write time** to persist a peer id or the word "PENDING" in an
actor:"asker" entry (throws in dev/test rather than silently leaking) —
tested directly by asserting the serialized `/api/state.asks[]` and
`/api/audit` contain neither the owner's peer id nor "PENDING".

## Documented interpretation calls

The brief said: never guess on I2/I3 semantics, but do flag and document
interpretation calls elsewhere. Besides the TTL/pending gap above:

1. **Matcher chain fall-through trigger** (`matcher/matcher.ts`). "Each
   stage falls through" is read as: a stage falls through to the next only
   when *that stage itself* is unavailable (network error, timeout, bad
   JSON after one retry) — **not** merely because its honest verdict was "no
   match." A real "nothing crossed the embedding threshold" stays a
   `no_match`; it does not retry via keyword fallback (keyword fallback is
   reserved for "no LLM/embeddings at all," per `CLAUDE.md`'s "Demo must
   survive with no LLM at all"). Verified with real qwen3-embedding:8b
   recordings: the "ladder" query scores 0.57 against the ladder item
   (below the 0.60 default threshold) — with a real embedding stage
   available but a weak shortlist, LLM adjudication is what actually
   converts a possible match, not a keyword retry.
2. **CONSENT never precedes STATUS(PENDING)** for a given card, even if the
   owner (human, or auto_forward) decides before the uniform delay elapses.
   The brief only states this ordering explicitly for `auto_forward`
   ("still send STATUS PENDING first ... then CONSENT"); this package
   applies the same rule uniformly to the human ask_each_time path too, since
   letting CONSENT race ahead of the uniform STATUS would itself be a subtle
   timing side-channel, against I3's spirit.
3. **Room chat is not in the frozen wire protocol.** `Envelope`'s union
   (REQUEST/STATUS/CONSENT/INTRO/WITHDRAWN) has no free-text chat type, and
   `TransportAdapter` exposes only `send` (the 5 envelope types) and
   `createSharedRoom` (mint an id) — no message-in-a-room primitive. A real
   MatrixTransport would likely deliver chat via the homeserver's native
   room timeline, entirely outside this envelope model. Until that lands,
   `transport/in_memory_transport.ts` defines a narrow, additive
   `RoomMessagingTransport` extension (`sendRoomMessage`/`onRoomMessage`)
   that `InMemoryTransport` implements; `daemon.ts` feature-detects it via
   `hasRoomMessaging()` and degrades to local-echo-only if a future
   transport doesn't support it. The request lifecycle itself never depends
   on anything beyond the base `TransportAdapter` (I5 intact).
4. **Room `context` is computed locally on each side, not transmitted.**
   `INTRO`'s body is just `{room_id}` (frozen). The owner's local
   `RoomRecord.context` is the rich card
   (`"${request text} — matched: ${item label}${conditions}"`); the asker's
   is simply its own ask text. Neither side needs anything the other side
   didn't already know pre-consent; nothing is transmitted to make this
   work.
5. **Second-brain relay (I8) is not implemented.** The M2 acceptance demo is
   all-`kind: "self"` items; `IncomingRecord.kind` is computed as `"relay"`
   whenever the matched item's provenance is `"second_brain"`, so the data
   model is relay-aware, but the actual first-relay consent ping (noted
   person pinged, may attach conditions, D1.6) is **not built** — it's not
   in the M2-A Definition of Done, and building it now would be overbuilding
   ahead of schedule. Left as a `FUTURE.md`-style TODO here rather than
   silently claimed as done.
6. **Transport factory's matrix arm.** `src/main.ts`'s `createTransport()`
   resolves `TRANSPORT=mock` to `InMemoryTransport` directly (no import from
   `@resource-web/transport` needed there). `TRANSPORT=matrix` throws a
   clear, actionable error: `@resource-web/transport` is still a stub
   (`export const PACKAGE = "transport"`) in this worktree — a sibling
   worktree owns it. Integration (a real `import { MatrixTransport } from
   "@resource-web/transport"`) happens at merge; the TODO is marked inline.
   `headless_demo.ts --transport=matrix` prints the same warning and falls
   back to mock so the demo still runs end to end.

## Known limitation: real-timer demo pacing vs. LLM latency

`STATUS_DELAY_MS` (2000ms in the demo, 30000ms production default) is the
delay from `receivedAt` (stamped the instant a REQUEST arrives, *before* the
matcher runs) to the scheduled STATUS dispatch. If the matcher's embedding +
LLM calls take longer than that delay (easily possible for a 2s demo delay
against real qwen3:4b latency), `RealScheduler.scheduleAt` still fires the
callback (immediately, since the target time is already in the past) — the
STATUS still goes out exactly once, correctly, just later than the nominal
uniform mark. This does not leak declined-vs-no-match (both experience the
same matching latency before their PASS/PENDING content is computed), but it
does mean the "uniform, no jitter" property is only as tight as matching
latency allows. Production's 30s default comfortably exceeds typical LLM
latency; a 2s demo delay does not, which is why `headless_demo.ts` polls for
state transitions (`waitUntil`) instead of assuming fixed sleeps.

Separately, `InMemoryTransport.send()` awaits the *full* receiver-side
`handleEnvelope` pipeline before resolving (see `in_memory_transport.ts`) —
deliberately, so `daemon.test.ts`'s fake-clock tests don't race on
fire-and-forget async delivery. Under real timers this means the asker's own
`sendAsk()` call doesn't return until the owner's entire matching pipeline
has finished; a real (decoupled) Matrix transport would not block the asker
like this. `headless_demo.ts`'s decline-branch TTL (30s) is sized generously
above this to avoid the ask timing out before the scripted decline action
even runs.

## Config table (docs/API.md, agent-daemon notes)

| Env var | Default (this package) | Notes |
|---|---|---|
| `PERSONA_NAME`, `PEER_ID` | required | — |
| `AGENT_PORT` | required | REST/WS bind port, 127.0.0.1 only |
| `DB_PATH` | `:memory:` | SQLite file path; `:memory:` for tests |
| `TRUSTED_PEERS_PATH` | unset | array of `TrustEdge`, loaded idempotently at boot |
| `FIXTURES_PATH` | unset | array of `Item`, loaded idempotently at boot |
| `OLLAMA_URL` | `http://localhost:11434` | — |
| `CHAT_MODEL` | `qwen3:4b` | matcher stage 2 + steward classify/extract |
| `EMBED_MODEL` | `qwen3-embedding:8b` | matcher stage 1; must match the model `test-fixtures/embeddings.json` was recorded with |
| `STATUS_DELAY_MS` | `30000` | uniform, no jitter (I3) — see latency caveat above |
| `MATCH_THRESHOLD` | `0.6` | embedding cosine threshold |
| `DEFAULT_ASK_TTL_MS` | `86400000` (24h) | asker-side ask TTL when not overridden per-ask |
| `TRANSPORT` | `mock` | `mock` \| `matrix` — see "Transport factory" above |
| `MATRIX_HOMESERVER_URL`, `MATRIX_ACCESS_TOKEN`, `MATRIX_REGISTRATION_SECRET` | unset | read but unused until the matrix arm is wired at merge |

## Running

```
pnpm --filter @resource-web/agent-daemon test        # vitest, offline
pnpm --filter @resource-web/agent-daemon typecheck
pnpm --filter @resource-web/agent-daemon build
pnpm --filter @resource-web/agent-daemon exec tsx scripts/record_embeddings.ts   # refresh test-fixtures/embeddings.json
pnpm --filter @resource-web/agent-daemon exec tsx scripts/headless_demo.ts --branch=consent
pnpm --filter @resource-web/agent-daemon exec tsx scripts/headless_demo.ts --branch=decline
```

`headless_demo.ts` accepts `--anna-port=`/`--ben-port=` overrides (defaults
4101/4102 per `docs/API.md`) in case those are already bound by another
process on a shared dev host.
