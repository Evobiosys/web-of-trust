# resource-web — "Does a friend have a screwdriver?"

A weekend-sprint prototype of **async, privacy-preserving resource sharing on a Web of Trust**.

Every person keeps a private inventory of idle resources on their own device. A friend asks in natural language, any language ("Hat wer einen Akkuschrauber?"). Matching happens **on the owner's device** — the asker never learns who owns anything. Only the anonymous aggregate comes back: *"Yes — someone can help, we let them know."* The owner gets a consent ping and decides freely; **consent — and only consent — reveals identity** and opens a shared Matrix room where the two humans arrange the handover.

Why: idle resources stay idle because of information asymmetry and social friction ("why won't you lend it to me?"). This design closes the asymmetry while protocol-protecting the owner from the social friction of saying no — a declined request and "nobody has one" look **byte-identical** to the asker.

## Privacy Honesty Box

> This prototype protects the owner from social exposure by **protocol design** (indistinguishable No, consent-gated identity). It does **not** yet protect against: an asker inspecting their own agent's raw traffic (privacy rung 1 fixes this), peers reading request texts (rung 2 fixes this), or homeserver metadata analysis (DIDComm/P2P transport reduces this). Claiming "zero-knowledge" for v0 would be false.
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

## Architecture

Two simulated devices (Anna asks, Ben owns), each: React UI → local agent daemon (TypeScript) → Matrix transport. One agent-daemon codebase, N persona configs. Modules meet only in `packages/protocol` (zod-validated envelope v0.1, request lifecycle, share policies) — transport (Matrix ↔ DIDComm), matcher (LLM ↔ keyword), and store all swap behind interfaces (proven by `MockTransport` in tests).

- [docs/PROTOCOL.md](docs/PROTOCOL.md) — messages, state machines, invariants I1–I9
- [docs/API.md](docs/API.md) — daemon ↔ UI contract
- [PRIVACY.md](PRIVACY.md) — the privacy ladder: what v0 protects, what v1/v2 will
- [VERIFICATION.md](VERIFICATION.md) — adversarial verification evidence (who learns what)
- [DECISIONS.md](DECISIONS.md) — append-only decision log

Trust edges v0 = seeded `trusted_peers.json` ("verified in person earlier"); the alignment target for real edges is OpenVTC Verifiable Relationship Credentials (DECISIONS.md D1.1).
