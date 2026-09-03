# CLAUDE.md — resource-web sprint

Async, privacy-preserving resource sharing on a Web of Trust. Two-device sim (Anna asks, Ben owns), TypeScript end-to-end, containers via **podman** (`DOCKER ?= podman` in Makefile — docker absent on this host).

## No push without explicit say-so

**Never push to any remote in this repo without the owner's explicit, per-push permission —
GitHub in particular.** Three remotes are configured: `github`, `ecstatic-world`, `jakobs-branch`.
Committing locally is expected and fine at any time; pushing is not — ask first, every time, even
if a prior push was approved. `github` already carries `alpha`, `cred-provider`, and `rebiosys`
branches pushed before this rule existed; that history doesn't imply standing permission for new
pushes.

## Invariants (violating one = stop and flag)
- **I1 Local sovereignty:** inventory never leaves the owner's device except local match results + post-consent item details.
- **I2 Asker blindness:** asker-facing UI/API shows only request status, anonymous aggregate, post-consent room. Never per-peer identity/inventory/response state pre-consent.
- **I3 Indistinguishable No:** declined vs no-match = byte-identical `PASS` wire messages on a uniform reply schedule (default 30 s, no jitter). Heart of the design.
- **I4 Contextual consent:** owner sees asker identity + request text. Asymmetry is deliberate.
- **I5 Swappability:** transport/matcher/store behind interfaces in `packages/protocol` — the only coupling point. `MockTransport` proves it in tests.
- **I6 Auditability:** every agent decision logged locally, human-readable.
- **I7 Honest labeling:** v0 is NOT zero-knowledge. README carries the Privacy Honesty Box. v1 target IS zero-knowledge (rungs 1–2, see DECISIONS.md D2).
- **I8 Provenance & hop-consent:** items record `self` vs `second_brain (told by A)`. Relays use the same consent chain; every hop consents; no hop reveals more than a direct request. Noted person is pinged at first relay, never at note creation, and may attach conditions (D1.6).
- **I9 Conservative defaults:** `ask_each_time`, `audience: "trusted"`, `expires_at` +1y on edges and policies.

## Architecture
- pnpm workspaces: `packages/protocol` (zod schemas, envelope v0.1, lifecycle state machine — no I/O), `packages/transport` (MatrixTransport via matrix-bot-sdk, MockTransport), `packages/agent-daemon` (SQLite stores, policy engine, matcher chain, REST/WS for UI), `apps/device-ui` (React 19 + Vite + Tailwind), `apps/dashboard` (side-by-side iframes :8080).
- One agent-daemon codebase, N persona configs. UI talks only to its own agent (REST/WS, localhost). Agents talk only via TransportAdapter.
- Matcher chain: embeddings (cosine ≥ 0.60) → LLM adjudication (strict JSON, temp 0) → keyword+synonym fallback. Demo must survive with no LLM at all.
- Models: host ollama `http://localhost:11434`, `CHAT_MODEL=qwen3:4b`, `EMBED_MODEL=qwen3-embedding:8b` (see DECISIONS.md D4).
- Envelope types: REQUEST / STATUS(PASS|PENDING) / CONSENT / INTRO / WITHDRAWN — zod-validated, versioned `v: "0.1"`.

## Process
- Milestones m0…m5 tagged in git. [S]-marked work only after M5 passes.
- Decisions → DECISIONS.md (append-only). Temptations → FUTURE.md. Never claim more privacy than implemented.
- `make demo` must work from a fresh clone, deterministically (recorded fixture embeddings for CI).
