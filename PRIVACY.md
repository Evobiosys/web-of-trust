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
| Homeserver admin | Metadata: who talks to whom, when. Not payloads if E2EE is on — **residual** |
| Network observer | Traffic patterns between homeservers/devices — **residual** |

## Rung 1 — next version [S1 spike exists behind a feature flag, if built]

Anonymous aggregate via **secure aggregation** (peers exchange additive masks; the asker learns only "≥ 1") and/or **PSI-CA** (private set intersection cardinality — [OpenMined/PSI](https://github.com/OpenMined/PSI), ECDH + Bloom filters). Fixes: the asker — even reading their own agent's raw logs — provably learns only the count.

## Rung 2 — research target (Anton's crew / Markus)

**Private matching:** peers learn the query only on match (OPRF/PSI over canonical tags — [mpc4j](https://github.com/alibaba-edu/mpc4j), [volepsi](https://github.com/Visa-Research/volepsi)); ZK predicates for coarse area claims. Fixes: non-matching peers learn nothing about the request. Transport metadata: DIDComm/P2P reduces homeserver visibility.

## Second-brain notes (I8, D1.5/D1.6)

Notes about *other people's* resources live only on the note-taker's device. The noted person is **not** notified that a note exists (individual agency — the same as human memory). They **are** consent-pinged before the knowledge is relayed to anyone else — at first relay attempt — and may attach conditions for giving the item out. No hop reveals more than a direct request would. Exclusion stays individual: downgrading a peer edits *my* trust graph, needs no appeals process, and sends no notification.
