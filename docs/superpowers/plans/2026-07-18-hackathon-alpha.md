# Hackathon Alpha Implementation Plan — REVISION 2 (Zach mockup = the client)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** By tomorrow evening, Jakob + hackathon friends alpha-test on their devices (phones on one LAN): Zach's v6/v7 mobile mockup (`reference/zach-mockup-v7.html` — THE UX version of truth) running as a real client against the agent-daemon backend, with app skins (ecstatic/housing/family/business) and one-degree-removed sharing.

**Revision 2 rationale (supersedes R1 Tasks 4/5):** Jakob's stated priority order: (1) Zach's UX implementations — functionality that does not require agents, (2) chats in general, (3) agents, (4) Matrix. Zach's mockup is a complete 5-tab app (Discover / Chat / Meet / Web / You) with its own spec-anchor registry (ANCHORS in the mockup source). We port the mockup itself (vanilla JS, adapted) as `apps/mobile-ui` instead of rebuilding in React. OpenVTC = seam + VRC-shaped export only this sprint (Jakob's answer). Matrix homeserver: local synapse container now, matrix.myceli.al later.

**Architecture:** `apps/mobile-ui` (vanilla JS + Vite, ported mockup) ⇄ `ApiClient` (fixture mode = mockup's demo data; live mode = daemon REST/WS) ⇄ agent-daemon (extended: trust levels, LISTING/LOAN/DM envelopes) ⇄ transport (InMemory hub for one-host alpha; Matrix/synapse for multi-host). Old `apps/device-ui` stays untouched (demo gallery).

**Mockup hard rules (bind every UI task):** private = invisible, never locked · no scores/ratings anywhere · no automated-system wording in the interface · asymmetry always labeled ("sees you: no").

## Global Constraints

- Invariants I1–I9 (`CLAUDE.md`) still bind. I3 (indistinguishable No) applies to ask-matching; listings are owner-published, so visibility filtering happens on the OWNER's side before send (a peer below tier receives NOTHING — mirroring "private = invisible").
- UX truth: `reference/zach-mockup-v7.html`. When porting a screen, preserve its copy, layout, class names, and interaction flow. Deviations only where real data requires; keep the poetic voice ("held between you", "Woven.").
- Protocol: additive changes only, integrator-approved (log like D7): TrustEdge.level, audience values, LISTING/LOAN/DM envelope types. Version string stays "0.1".
- Package filters: `@resource-web/{protocol,transport,agent-daemon,device-ui,dashboard}` + new `@resource-web/mobile-ui`.
- Tests: node-ish vitest per package; `pnpm -r test` must stay green. TDD for backend logic; UI screens get smoke/behavior tests (vitest+jsdom) not pixel tests.
- podman not docker; Node 26; daemon deps stay lean (node:http, ws).
- Decisions → DECISIONS.md (append-only). Temptations → FUTURE.md.

## Status ledger reference

- Task 0 ✅ merge m2-agent → main (tag m2), branch `alpha`.
- Task 1 ⏳ relay two-hop consent chain (daemon) — brief `.superpowers/sdd/task-1-brief.md` (unchanged from R1).
- Task 3 ✅ app-profile system in device-ui (branch alpha-t3; will be lifted to `packages/app-profiles` in Task 7).

---

### Task 2 (REVISED): protocol + store + daemon extensions — levels, listings, loans, DMs

**Files:**
- Modify: `packages/protocol/src/schemas.ts` (TrustEdge.level, audience enum), `packages/protocol/src/envelope.ts` (LISTING/LOAN/DM), `packages/protocol/src/index.ts`
- Modify: `packages/agent-daemon/src/store/{types.ts,store.ts,sqlite_store.ts}` (listings, received_listings, loans, threads tables)
- Modify: `packages/agent-daemon/src/daemon/{daemon.ts,envelopes.ts}` (publish/receive/forward listings; borrow flow; loan transitions; DM threads)
- Test: colocated `*.test.ts` (TDD)

**Schema changes (exact):**
```ts
// TrustEdge gains:
level: z.enum(["contact","friend","close"]).default("friend")
// SharePolicy.audience becomes:
z.enum(["private","close","trusted","wot_commons","public"])   // close+public new; trusted="Friends" tier, wot_commons="The Commons"
// New envelope bodies (v stays "0.1"):
LISTING: { listing_id, kind: "offer"|"gathering", title, description, when?, where_public?, where_gated?, tier: audience, steps: 1|2|3, via: PeerId[], state: "active"|"withdrawn", owner_display }
LOAN:    { listing_id, loan_id, state: "requested"|"approved"|"declined"|"lent"|"returned"|"complete"|"not_yet", note? }
DM:      { text }
```

**Behavior:**
1. `publishListing(input)` → store + send LISTING to eligible edges by tier: close→level "close"; trusted→"close"+"friend"; wot_commons/public→all edges. `public` listings additionally appear in guest/unauthenticated local API responses.
2. Receiving a LISTING: store in received_listings (dedupe by listing_id, last-write-wins). If `steps > 1` and my edge-level to sender satisfies tier: forward once to my eligible edges (excluding origin + already-via peers) with `steps-1`, `via: [...via, me]`. No consent ping for forwarding (it is the owner's declared reach) — but NEVER forward `close`-tier listings (inner room stays inner). Log every forward (I6).
3. Withdraw: state "withdrawn" propagates same route; receivers mark inactive.
4. Borrow: `requestBorrow(listing_id)` → LOAN "requested" direct to owner (via `via`-chain if not directly connected: alpha = direct only; via-chain borrow goes through existing relay/ask flow — note in FUTURE.md). Owner sees consent-card-like activity item; approve → LOAN "approved" then "lent"; borrower "returned" → owner confirm → both sides completion check-in ("complete" | "not_yet"). `not_yet` detail stays local (mockup RES-5: visible only to own close circle — alpha: local only).
5. DMs: `sendDm(peer_id, text)` → DM envelope; store per-peer thread both sides; only between connected peers (any level).
6. Events for the UI: extend `/api/state` snapshot (Task 5 wires HTTP; here: daemon getters) with `listings_mine`, `listings_received`, `loans`, `threads`, and `trust_edges[].level`.

**Steps:** TDD per behavior (publish tier-filtering incl. "peer below tier receives nothing"; forward decrement + close-tier never forwarded; withdraw; loan happy path + not_yet; DM both directions) → implement → `pnpm --filter @resource-web/protocol test && pnpm --filter @resource-web/agent-daemon test` green → typecheck → DECISIONS.md entry (additive protocol change) → commit `feat(protocol,daemon): trust levels, listings, loans, DM threads`.

---

### Task 4 (REVISED): port Zach's mockup → `apps/mobile-ui` (fixture mode)

**Files:**
- Read first (THE spec): `reference/zach-mockup-v7.html` (1618 lines, self-contained). Also `apps/device-ui/vite.config.ts` + `package.json` as Vite/vitest reference.
- Create: `apps/mobile-ui/{package.json,vite.config.ts,tsconfig.json,index.html}`
- Create: `apps/mobile-ui/src/styles.css` (mockup CSS, phone frame made full-viewport-first: keep the `@media (max-width:480px)` full-bleed branch as default on mobile; desktop keeps the phone frame + notes panel hidden)
- Create: `apps/mobile-ui/src/api_client.js` — `createApiClient({ mode: "fixture" | "live", agentUrl })`; fixture mode returns the mockup's demo data (EVENTS, OFFERS, THREADS, rings people, activity seed) behind the SAME interface live mode will implement: `getState()`, `subscribe(cb)`, `publishListing(x)`, `requestBorrow(id)`, `loanAction(loan_id, state)`, `sendDm(peer, text)`, `addTrust(card, level)`, `setVisibilityDial(on)`, `sendSteward(text)` (steward = agent chat, wired later)
- Create: `apps/mobile-ui/src/screens/{onboarding.js,discover.js,chat.js,host.js,web.js,meet.js,you.js,settings.js}` — the mockup's render functions, split per screen, state via a small `store.js` (the mockup's `state` object + pub/sub)
- Create: `apps/mobile-ui/src/{sheet.js,tabs.js,spec_mode.js,confetti.js}` (shared chrome; KEEP spec mode + ANCHORS registry working — collaborators use it)
- Test: `apps/mobile-ui/src/screens/*.test.js` smoke tests (screen renders; key interactions mutate state: host publish adds card; borrow request pushes activity; ceremony reaches celebration; guest mode hides tabs)

**Port rules:**
- Vanilla JS stays vanilla (type-checked via JSDoc + `checkJs` in tsconfig; no React). ES modules instead of the single IIFE. Keep class names/CSS verbatim where possible.
- All 5 tabs + onboarding + ceremony + celebration + sheets + coach chip + guest mode + spec mode work exactly as in the mockup, powered by the fixture ApiClient.
- The "Message" flows open the thread sheet (THREADS fixture).
- `pnpm --filter @resource-web/mobile-ui dev` serves it; `build` green; tests green.
- Commit per screen-group; final commit `feat(mobile-ui): Zach mockup ported as modular app (fixture mode)`.

---

### Task 5 (REVISED): daemon HTTP surface — old alpha API + new endpoints + CORS + bind host

Everything from R1-Task-2 (POST/DELETE `/api/trust` with `level`, POST `/api/notes`, CORS `*` + OPTIONS 204, `API_HOST` env default 127.0.0.1, docs/API.md update) PLUS:
```
GET  /api/listings                          → { mine: [...], received: [...] }   (guest param ?public=1 → public tier only, no auth)
POST /api/listings                          { kind, title, description, when?, where_public?, where_gated?, tier, steps } → { listing_id }
POST /api/listings/:id/withdraw             → { ok }
POST /api/borrow                            { listing_id } → { loan_id }
POST /api/loans/:loan_id                    { state: "approved"|"declined"|"lent"|"returned"|"complete"|"not_yet", note? } → { ok }
GET  /api/threads                           → { threads: [{ peer_id, display, messages: [{from,text,ts}] }] }
POST /api/threads/:peer_id/message          { text } → { ok }
GET  /api/card                              → { peer_id, display, level_offer_default }   (the "my QR card" payload)
```
WS events added: `listing { listing_id }`, `loan { loan_id }`, `dm { peer_id }` (plus existing `state_changed` catch-all).
TDD; docs/API.md updated; commit `feat(daemon): listings/loans/threads/trust HTTP surface, CORS, LAN bind`.

---

### Task 6: wire mobile-ui live mode

**Files:** `apps/mobile-ui/src/api_client.js` (live implementation: fetch + WS against Task-5 endpoints), `runtime_config.js` (query `?agent=…&app=…&persona=…` > localStorage > defaults — same precedence rules as device-ui's Task-3 module), Meet screen: real QR (dep `qrcode`, already in pnpm store) rendering `/api/card` payload; "Scan theirs instead" uses `BarcodeDetector` when available + ALWAYS a manual "enter their code" fallback (iOS Safari has no BarcodeDetector); confirm → `addTrust(card, level)` → celebration. Web rings render real `trust_edges` (ring 1) + ring 2 from received listings' via-chains and relay-known peers ("Someone · via X" for anonymous relay offers — daemon Task 1).
**Definition of done:** two daemons (in-memory hub, Task 8's harness pattern or test server) + two mobile-ui instances: meet ceremony creates mutual edge; host gathering on A appears in B's Discover per tier; borrow flow round-trips with activity cards; DM thread works; withdraw flips cards. Vitest integration test with mocked fetch/WS for the client; manual curl transcript in the report.

---

### Task 7: skins on mobile-ui + `packages/app-profiles`

Lift Task 3's profiles (branch alpha-t3, `apps/device-ui/src/profiles/*`) into `packages/app-profiles` (framework-free TS, same tests); device-ui imports move; mobile-ui consumes: profile → CSS custom-property theme block + copy overrides (brandName, headings, suggestion/quick-add lists) + `hidden` panes (housing: Discover defaults to Offers segment, gathering-chips swap for housing chips: "Room free", "Couch", "Short stay", "Longer stay"; family: default offer level "close"; business: "contact", Meet copy sobered). `?app=` query switches skin (runtime_config). Tests: profile → applied CSS vars + hidden tabs.

---

### Task 8: alpha server + LAN scripts + ALPHA.md

As R1-Task-6, updated: alpha_server hosts N daemons with `API_HOST=0.0.0.0`, ports 4101…; default `TRANSPORT=didcomm` (real OpenVTC-pillar transport over localhost/LAN HTTP, Task 11; in-memory hub remains the test/fallback mode, `TRANSPORT=mock`); serves `mobile-ui` dev server `--host` on 5173; join URLs `http://<ip>:5173/?agent=http://<ip>:410N&app=ecstatic&persona=<key>` (+ housing variant URLs) + QR printout (`qrcode-terminal` via npx, plain URLs fallback); EXIT trap kills everything; smoke test (2 personas: state OK, listing propagates, borrow round-trips); ALPHA.md quickstart + ⚠️ no-auth LAN warning + Matrix path (`--profile local` synapse, image prefetched; matrix.myceli.al later) + troubleshooting (LuLu inbound, same subnet). Root script `"alpha"`.

---

### Task 9: end-to-end verification + docs closure

As R1-Task-7 plus: mockup-fidelity pass (each ANCHOR-tagged surface present and honoring its contract — walk the golden path: guest browse → join → meet as Contact (nothing opens) → re-meet as Friend → gated gathering appears → host → offer → borrow → return → completion), transcript to `verification/alpha-run.txt`, README alpha section, DECISIONS/FUTURE entries (incl.: consensual-org repo auth gap, mockup v6 label vs v7 naming, OpenVTC next steps, holons dashboard vision → `reference/holons`).

---

### Task 11: OpenVTC pillar — DID identities, DIDComm transport, signed VRC trust edges (BEFORE any further Matrix work; D12)

**Files:**
- Create: `packages/transport/src/didcomm_transport.ts`, `packages/transport/src/did_identity.ts`, `packages/transport/src/vrc.ts` (+ colocated tests)
- Modify: `packages/agent-daemon/src/config.ts` (TRANSPORT="didcomm" option + identity paths), `packages/agent-daemon/src/main.ts` (wire), `packages/agent-daemon/src/api/server.ts` (mount transport's inbound HTTP handler at `POST /didcomm`; add `GET /api/trust/export?format=vrc`)
- Modify: `docs/TRANSPORT.md` (+OpenVTC section), `PRIVACY.md` (transport-metadata note: DIDComm peer-to-peer removes homeserver metadata residual)

**Design (exact):**
- `did_identity.ts`: `createIdentity(): { did, secrets }` — did:peer:2 with one Ed25519 signing key + one X25519 key-agreement key + serviceEndpoint (`http://<host>:<port>/didcomm`); deterministic (de)serialization to disk (`DID_IDENTITY_PATH`). Resolution: local resolver that decodes did:peer:2 inline keys (no network). Use `@noble/curves`/`@noble/hashes` + `multiformats` (in pnpm store) — pure JS, no wasm dependency risk; the `didcomm` wasm package is in the store as fallback if full JWM compliance turns out cheaper that way.
- `didcomm_transport.ts` implements the frozen `TransportAdapter`: `send(peerDid, env)` → resolve endpoint from did:peer:2 → encrypt (X25519 ECDH-ES + XChaCha20-Poly1305 via @noble/ciphers, sender-authenticated: include sender DID, sign payload Ed25519) → HTTP POST; inbound handler decrypts/verifies → `onEnvelope(fromDid, env)`. Message format: JWM-shaped JSON `{ id, type: "https://didcomm.org/basicmessage/2.0/message"-style app type, from, to, created_time, body: <protocol envelope> }`. Honest labeling: "DIDComm v2-shaped, not certified-interoperable yet" — docs/TRANSPORT.md states exactly what deviates from the RFC (I7 spirit).
- `createSharedRoom(peers, ctx)`: DIDComm has no rooms — implement group threads: `room_id = uuid`, room-create message fanned to all peers; `send`-to-room = fan-out to members. Same TransportAdapter surface, so MatrixTransport stays drop-in (D12's "easy to add Matrix later" = the seam, already proven by MockTransport/MatrixTransport).
- `vrc.ts`: on trust-edge creation, issue + store an **unsigned-claims-free, Ed25519-signed** VRC-shaped W3C VC: `{ "@context": [...], type: ["VerifiableCredential","RelationshipCredential"], issuer: myDid, credentialSubject: { id: peerDid, relationship: level, met_context? }, issuanceDate, proof: { type: "Ed25519Signature2020"-shaped JWS } }`. Both directions (each side issues). `GET /api/trust/export?format=vrc` returns mine. Verification helper + test. README/PRIVACY honesty: alpha VRCs are self-asserted pairwise, no witness (keyring-wallet/OpenVTC witness = future).
- PeerId remains a string; DIDs are valid PeerIds (protocol comment updated, no schema change). Meet-card payload (`/api/card`, Task 5) gains `did` + `endpoint` when TRANSPORT=didcomm.
- Tests: two daemons over real DidCommTransport on localhost HTTP complete REQUEST/STATUS/CONSENT/INTRO/WITHDRAWN + LISTING/LOAN/DM; tamper test (bad signature rejected + audit-logged); VRC issue/verify round-trip.
- Commit granularity: identity, transport, vrc, wiring.

### Task 10 [FOLDED INTO TASK 11]: keyring-wallet / VRC export

Superseded — Task 11 ships signed VRCs + the export endpoint as core (D12). Keyring-wallet mapping notes + sebra witness/moderator hosting: FUTURE.md only.

## Self-review notes (R2)

- User priorities: Zach UX ✅ (T4 is the mockup itself, ported; hard rules bound globally), chats ✅ (DM threads T2/T5/T6 + activity), agents kept secondary ✅ (steward endpoint still exists; relay T1 continues), Matrix ✅ (synapse image prefetched, profile documented, transport untouched).
- Holons dashboard (minimal overview): the mockup's Web tab (rings + people + intros) IS the alpha overview; deeper holons-style boards → FUTURE.md with `reference/holons`. Jakob chose "minimal overview tab" — satisfied by Web tab + reach previews; noted explicitly in T9 docs.
- Type consistency: ApiClient interface named identically in T4 (fixture) and T6 (live); endpoint names in T5 match T6 calls; profile exports (`getProfile`, `ALL_PROFILES`) preserved through the T7 lift.
- YAGNI guards: no reputation, no scores, no bridges this sprint, no OpenVTC runtime, amends/tags stay placeholders (mockup marks them "held for a future circle").
