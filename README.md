# resource-web — "Does a friend have a screwdriver?"

A weekend-sprint prototype of **async, privacy-preserving resource sharing on a Web of Trust**.

Every person keeps a private inventory of idle resources on their own device. A friend asks in natural language, any language ("Hat wer einen Akkuschrauber?"). Matching happens **on the owner's device** — the asker never learns who owns anything. Only the anonymous aggregate comes back: *"Yes — someone can help, we let them know."* The owner gets a consent ping and decides freely; **consent — and only consent — reveals identity** and opens a shared Matrix room where the two humans arrange the handover.

Why: idle resources stay idle because of information asymmetry and social friction ("why won't you lend it to me?"). This design closes the asymmetry while protocol-protecting the owner from the social friction of saying no — a declined request and "nobody has one" look **byte-identical** to the asker.

## Privacy Honesty Box

> This prototype protects the owner from social exposure by **protocol design** (indistinguishable No, consent-gated identity). It does **not** yet protect against: an asker inspecting their own agent's raw traffic (privacy rung 1 fixes this), peers reading request texts (rung 2 fixes this), or homeserver metadata analysis (DIDComm/P2P transport reduces this). Claiming "zero-knowledge" for v0 would be false.
>
> The v0.1 alpha surfaces obey the same posture: **listings** are owner-*published* to tier-eligible trust edges (a `private` listing is never sent at all; `close` reaches only `close`-level edges; the guest `?public=1` view strips the gated `where_gated` field server-side and exposes `public`-tier only). **Loans** and **DMs** are connected-only (a trust edge must exist), and a loan's "not yet" check-in note stays local — never on the wire. **Second-brain relays** ping the noted person only at first relay, consent every hop, and reveal no more than a direct request would (I8). The alpha's REST API has **no authentication** — LAN exposure is a deliberate, closed-room opt-in (see [ALPHA.md](ALPHA.md)).
>
> **v1 commitment:** the next version targets actual zero-knowledge properties — the asker learns only the aggregate, provably; non-matching peers learn nothing about the request. See [PRIVACY.md](PRIVACY.md).

## Quickstart

Requirements: a container runtime (`podman` or `docker`) + compose, node ≥ 20, pnpm, git, make. Optional: a local [ollama](https://ollama.com) for LLM matching — without it a keyword fallback keeps the demo alive.

```bash
make gate                  # environment check
cp .env.example .env       # defaults are hermetic
pnpm install && pnpm -r build
make up                    # local synapse (+ ollama profile if you want it in-stack)
make demo                  # scripted demo → snapshots/index.html gallery
```

`make revert STEP=04` checks out a step tag and restarts the sim so any demo moment can be replayed live.

## Alpha (v0.1) — one-command LAN demo

For the hackathon playtest there is a single command that boots six friend
personas (each a full agent-daemon) plus the mobile UI, all reachable from
phones on the same WiFi:

```bash
pnpm alpha        # → prints one join URL + QR per persona; Ctrl-C stops all
```

Wait for `alpha environment ready.`, then each friend scans their QR. See
[ALPHA.md](ALPHA.md) for the full runbook, security caveats, and troubleshooting.

- **Four client skins** — `ecstatic`, `housing`, `family`, `business`
  (`packages/app-profiles`): copy, theme, suggestion chips and quick-adds only.
  A skin is a *presentation* layer; the daemon keeps its conservative I9
  server-side defaults regardless of which skin is loaded (DECISIONS.md D10).
- **Transport = OpenVTC / DIDComm** (`TRANSPORT=didcomm`, the default). Messages
  are sign-then-encrypted (X25519 ECDH-ES + XChaCha20-Poly1305 + Ed25519) and
  POSTed **directly** to the recipient's own `did:peer:2` endpoint — no
  homeserver, no mediator, no directory (DECISIONS.md D12, PRIVACY.md). Matrix
  stays in-tree as a secondary path but is **not** wired for `pnpm alpha`.
- **What the alpha exercises** (verified end-to-end, `verification/alpha-run.txt`):
  seeded trust with levels, tiered listings (offers/gatherings) that reach only
  tier-eligible peers, the borrow round-trip (requested → approved → lent →
  returned → complete), connected-only DMs, the guest public view, and the
  second-brain two-hop consented relay.

## Architecture

Two simulated devices (Anna asks, Ben owns), each: React UI → local agent daemon (TypeScript) → Matrix transport. One agent-daemon codebase, N persona configs. Modules meet only in `packages/protocol` (zod-validated envelope v0.1, request lifecycle, share policies) — transport (Matrix ↔ DIDComm), matcher (LLM ↔ keyword), and store all swap behind interfaces (proven by `MockTransport` in tests).

- [docs/PROTOCOL.md](docs/PROTOCOL.md) — messages, state machines, invariants I1–I9
- [docs/API.md](docs/API.md) — daemon ↔ UI contract
- [PRIVACY.md](PRIVACY.md) — the privacy ladder: what v0 protects, what v1/v2 will
- [VERIFICATION.md](VERIFICATION.md) — adversarial verification evidence (who learns what)
- [DECISIONS.md](DECISIONS.md) — append-only decision log

Trust edges v0 = seeded `trusted_peers.json` ("verified in person earlier"); the alignment target for real edges is OpenVTC Verifiable Relationship Credentials (DECISIONS.md D1.1).
