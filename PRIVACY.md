# PRIVACY.md — the privacy ladder

v0 is **honestly labeled NOT zero-knowledge** (invariant I7). Its protection is *protocol-shaped*, not cryptographic. This file states exactly who can learn what, and what each next rung fixes. **The next version commits to climbing to zero knowledge** (rungs 1–2); cryptography review is owned by Markus (DECISIONS.md D1.3, D2).

## Rung 0 — this sprint (implemented)

Mechanism: unlinkability by protocol — uniform STATUS schedule (default 30 s, no jitter), indistinguishable PASS (declined vs no-match byte-identical), E2EE-capable agent DMs, UI-enforced asker blindness, consent-gated identity.

| Party | Learns |
|---|---|
| Asker (human, via UI/API) | Request status + anonymous aggregate only; owner identity only post-consent |
| Asker's own agent process | Technically sees which peer sent PENDING (UI hides it; logs redact it) — **residual** |
| Queried peers' devices | The request text itself — necessary for local matching — **residual** |
| Owner | Asker identity + request text (deliberate, I4 — consent requires context) |
| Homeserver admin | Metadata: who talks to whom, when. Not payloads if E2EE is on — **residual** (Matrix only; see below) |
| Network observer | Traffic patterns between homeservers/devices — **residual** |

### Transport-metadata note — OpenVTC / DIDComm pillar (Task 11, D12)

The primary transport is now the **peer-to-peer OpenVTC pillar**
(`DidCommTransport`), which removes the *"Homeserver admin"* residual above:
there is **no homeserver, no mediator, and no directory** — messages are
sign-then-encrypted and POSTed **directly** to the recipient's own
`http://host:port/didcomm` endpoint (resolved locally from their `did:peer:2`).
No third party sees who talks to whom. The sender DID is **not** in the
cleartext wire (it rides inside the ciphertext, authenticated), so even an
observer of a single message body cannot attribute it. What **remains** a
residual: a direct network observer still sees *that* two IP endpoints exchange
traffic (no onion routing / mixnet in alpha), and the recipient's endpoint host
is contacted directly. Payload confidentiality + sender-authenticity are
cryptographic here (X25519 ECDH-ES + XChaCha20-Poly1305 + Ed25519); the
**honesty caveat** is that this is DIDComm-v2-*shaped*, not RFC-interoperable,
and VRC trust edges are **self-asserted pairwise** (no witness) — see
`docs/TRANSPORT.md §10.5`. Matrix stays available as a fallback transport and
carries the homeserver-metadata residual it always did.

### v0.1 alpha surfaces — listings, loans, DMs (who learns what)

The alpha (D17) adds owner-*published* surfaces on top of the ask/consent core. They keep the rung-0 posture:

| Surface | Who learns what |
|---|---|
| **Listing (offer/gathering)** | Owner-published to *tier-eligible* trust edges only. `private` is never sent (local-only); `close` reaches only `close`-level edges; `trusted` reaches `friend`/`close`; `wot_commons`/`public` reach every edge. A withdrawal re-propagates to flip the receiver's copy `withdrawn`. |
| **Guest view (`GET /api/listings?public=1`)** | `public`-tier active listings only, with `where_gated` **stripped server-side** (absent from the JSON, not merely `undefined`); a guest gets `where_public` only. `wot_commons` is *not* guest-visible. |
| **Loan (borrow lifecycle)** | Connected-only (a trust edge is required). Only the coarse state (`requested…complete`) crosses the wire; a "not yet" check-in note is a local-only annotation, never sent. |
| **DM thread** | Connected-only on both send and receive (`sendDm`/`receiveDm` require a trust edge — defense in depth). |

**No-auth caveat (alpha only):** `pnpm alpha` binds every daemon to `0.0.0.0` with **no authentication** — anyone on the same WiFi who can reach `http://<ip>:410N` can call the REST API directly, and `?public=1`'s strip is *client-cooperation only* (no auth boundary enforces it). This is a deliberate closed-room opt-in; see [ALPHA.md](ALPHA.md)'s security box. It does not change the protocol-level residuals above.

## Rung 1 — next version [S1 spike exists behind a feature flag, if built]

Anonymous aggregate via **secure aggregation** (peers exchange additive masks; the asker learns only "≥ 1") and/or **PSI-CA** (private set intersection cardinality — [OpenMined/PSI](https://github.com/OpenMined/PSI), ECDH + Bloom filters). Fixes: the asker — even reading their own agent's raw logs — provably learns only the count.

## Rung 2 — research target (Anton's crew / Markus)

**Private matching:** peers learn the query only on match (OPRF/PSI over canonical tags — [mpc4j](https://github.com/alibaba-edu/mpc4j), [volepsi](https://github.com/Visa-Research/volepsi)); ZK predicates for coarse area claims. Fixes: non-matching peers learn nothing about the request. Transport metadata: DIDComm/P2P reduces homeserver visibility.

## Second-brain notes (I8, D1.5/D1.6)

Notes about *other people's* resources live only on the note-taker's device. The noted person is **not** notified that a note exists (individual agency — the same as human memory). They **are** consent-pinged before the knowledge is relayed to anyone else — at first relay attempt — and may attach conditions for giving the item out. No hop reveals more than a direct request would. Exclusion stays individual: downgrading a peer edits *my* trust graph, needs no appeals process, and sends no notification.
