# Self-Sovereign Browser Identity + QR-URL Connect (origin-node onboarding)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) tracking.

**Goal:** A new device points its **native camera** at an origin's QR, the app opens, **generates its own DID/keys in the browser** (true self-sovereign — keys never leave the device), and — after the **origin owner consents** — connects to the origin and can message it. This is the origin-node model: the owner is the origin; whoever they let in "can then connect with others on their own."

**Architecture:** A UI-agnostic `packages/browser-agent` holds identity (reuse transport's `did_identity`/`didcomm_crypto` — already isomorphic, `@noble`/`multiformats` only), IndexedDB key persistence, and a browser relay client (port `relay_channel` `ws`→native `WebSocket`). The origin's Meet screen renders a QR that encodes a **connect URL** (not a raw payload the app must camera-scan). A daemon-side, **consent-gated** inbound CONNECT handler forms the trust edge both ways. Thin UI glue lives in the vanilla `apps/mobile-ui` (what the user demos on); the core carries to `apps/web` (React) unchanged.

## Global Constraints
- **HTTP-only alpha — NO secure-context APIs.** Do NOT use `navigator.mediaDevices.getUserMedia` or `BarcodeDetector` (they require HTTPS/localhost and fail on `http://<LAN-IP>` on phones). The QR encodes a URL the **native camera app** opens; the browser never accesses the camera. In-app scanning is a future HTTPS-deployment feature (FUTURE.md).
- **Self-sovereign:** keys are generated in the browser via `@noble` and stored in **IndexedDB** on the device; they never transit the network. Identity MUST survive reload (else every reload mints a new profile and drops connections).
- **Consent-gated connect (I4 + origin-node):** a scanned connect never auto-adds an edge; the origin owner sees a consent card and approves. Only on approval does the new peer become connected.
- **Browser receives via draining the mediator relay** — so a browser with no HTTP endpoint is reachable. This depends on the relay contract; **build the relay-dependent tasks only after the mediator security fix is merged to `alpha`** (that fix changes the submit response + drain).
- Reuse `did_identity.ts`/`didcomm_crypto.ts` verbatim where possible — confirmed browser-safe (no node-only imports).
- Invariants I1–I9 bind. Honest labeling (I7): browser secrets in IndexedDB are alpha-grade (not hardware-backed) — say so.
- **Definition of done is a REAL device, not vitest.** A second browser opened at the LAN IP (`http://<LAN-IP>:5173/?connect=…`) that generates its OWN identity, drains the LIVE relay, completes the consent-gated connect, and exchanges a message with the origin. Every past breakage (firewall, fixture mode) passed tests then failed on real use — this acceptance test is mandatory.

---

### Task 1 [relay-independent — start now]: `packages/browser-agent` — identity + IndexedDB persistence
**Files:** create `packages/browser-agent/{package.json,tsconfig.json}`, `src/identity.ts`, `src/store.ts` (IndexedDB), `src/index.ts`, tests `src/*.test.ts` (vitest + jsdom + `fake-indexeddb`).
- `generateIdentity()`: reuse transport's `did_identity` identity shape (Ed25519 + X25519 + did:peer:2). Import from `@resource-web/transport` if its identity fns are exported browser-safely; if the transport entry pulls node-only code transitively, re-implement the ~30 lines over `@noble/curves` + `multiformats` directly (the source is `packages/transport/src/did_identity.ts` — copy the pure logic, no `ws`/node). Its service endpoint for a browser peer is the **relay** (browser can't be dialed directly).
- `loadOrCreateIdentity()`: read the identity (DID + secret keys) from IndexedDB; if absent, generate + persist; return it. Keys stored as raw bytes; document the alpha-grade (not hardware-backed) caveat.
- `clearIdentity()` for testing/reset.
- Tests: generate → persist → reload returns SAME did; two generates differ; survives a simulated reload (new store instance, same fake-indexeddb).
- Commit `feat(browser-agent): self-sovereign DID identity with IndexedDB persistence`.

### Task 2 [relay-independent — start now]: origin QR encodes a connect URL
**Files:** modify `apps/mobile-ui/src/screens/meet.js` (the Meet/ceremony screen), reuse the `qrcode` dep already present.
- The origin (any logged-in persona) shows a QR encoding: `<appOrigin>/?connect=<myDID>&relay=<myRelayUrl>&app=<appId>` — NO persona param (a fresh device). `myDID` + `myRelayUrl` come from the live `GET /api/card` (which carries `did` + relay endpoint; T8 added `relays[]`). Render with `qrcode` to a canvas/img (no camera).
- Add a visible "Show my connect code" affordance + the raw URL as a copy-paste fallback (phones without a QR-native camera, or desktop).
- Copy stays in the app's voice ("Let someone in — they point their camera here and become their own node").
- Test (vitest+jsdom): given a mock card, the QR/link encodes the exact `?connect=&relay=&app=` URL; no persona param present.
- Commit `feat(mobile-ui): origin shows a connect-URL QR (native-camera friendly, no secure-context)`.

### Task 3 [AFTER mediator fix merged]: browser relay client
**Files:** `packages/browser-agent/src/relay_client.ts` (+ test).
- Port `packages/transport/src/relay_channel.ts` to the browser: swap `import { WebSocket } from "ws"` for the native `WebSocket` (either a browser build entry, or inject the WS constructor via config so the same code runs both places). Keep `fetch`-based submit. Implement authenticated drain (the fixed drain-auth: nonce challenge → Ed25519 sign → attach). Decrypt inbound via `didcomm_crypto` (browser-safe).
- Build against the MERGED relay contract (submit → `{routed:"accepted"}`, caps, drain auth as fixed). Read the fix report before starting.
- Tests: browser client ↔ live `RelayServer` (node test harness) round-trip: submit reaches queue; drain delivers + decrypts; bad-sig drain rejected.
- Commit `feat(browser-agent): browser relay client (native WS drain + fetch submit)`.

### Task 4 [AFTER mediator fix merged]: daemon consent-gated inbound CONNECT
**Files:** `packages/protocol` (a CONNECT envelope type OR reuse the existing connect/INTRO semantics — integrator picks, additive, v stays "0.1"), `packages/agent-daemon/src/daemon/daemon.ts` (+ `api/server.ts` WS event, store), tests.
- Inbound: a new peer sends a CONNECT (via relay, encrypted to origin DID, from new-peer DID) carrying `{ display, relay }`. Origin daemon surfaces a **consent card** ("<name> wants to connect — they scanned your code"). NOT auto-accept.
- On origin **accept**: form a `TrustEdge` to the new peer (level default per app profile — ecstatic `friend`, family `close`, business `contact`) + reply so the new peer learns the origin's edge back (a CONNECT-ACK / INTRO). On **decline**: nothing revealed beyond a gentle no (I2/I3 spirit).
- Origin-node semantics: the origin is not a community; it's a single node letting individuals in, who then hold their own web.
- Tests: new-peer CONNECT → origin consent card; accept → both sides have the edge; decline → no edge, no leak; unconsented connect never forms an edge.
- Commit `feat(protocol,daemon): consent-gated inbound CONNECT (origin-node)`.

### Task 5 [AFTER 3+4]: onboarding wiring — `?connect=` → self-sovereign new profile
**Files:** `apps/mobile-ui/src/main.js` + `src/screens/onboarding.js` + a small connect flow module; consume `browser-agent`.
- A URL with `?connect=<did>&relay=<url>` and NO persona → the self-sovereign path: `loadOrCreateIdentity()` (browser keys) → ask the human their display name (keep the onboarding name step) → open the browser relay client → send CONNECT to the origin → show "waiting for <origin> to let you in…" → on CONNECT-ACK, enter the app as the new self-sovereign profile (its own DID, connected to origin). 
- A plain no-persona URL (no `?connect`) still shows normal onboarding.
- The new profile persists (reload keeps identity + connection).
- Test (jsdom, mocked relay client): `?connect=` triggers identity load + CONNECT send; ack → entered.
- Commit `feat(mobile-ui): self-sovereign onboarding via scanned connect URL`.

### Task 6 [AFTER all]: REAL-DEVICE end-to-end (the acceptance test)
- Boot the alpha stack (`pnpm alpha`, mediator path). From the origin persona's Meet screen, get the connect-URL QR.
- Open a SECOND browser at the **LAN IP** with that `?connect=` URL (simulating a phone via native-camera open) — it must generate its OWN identity (verify a fresh DID, not a seeded persona), drain the LIVE relay, send CONNECT.
- On the origin, approve the consent card. Confirm the new browser enters connected; send a message each way and confirm it arrives. Capture the transcript to `verification/qr-onboarding-run.txt`.
- Kill all servers; no orphans. Commit `docs: self-sovereign QR onboarding verification (real second-client e2e)`.

## Self-review notes
- Camera/secure-context sidestepped by QR-encodes-URL + native camera (the only thing that works on HTTP phones).
- Relay-dependent tasks (3–6) gated on the merged mediator fix.
- Reuse maximized (identity/crypto verbatim; relay client = ws→native swap). New: IndexedDB persistence, consent-gated CONNECT, onboarding wiring.
- DoD is a real second client on the LAN IP draining the live relay — not vitest.
- FUTURE.md: in-app `BarcodeDetector` scanning once the app is served over HTTPS (questhub); hardware-backed key storage.
