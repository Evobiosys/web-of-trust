# DECISIONS.md — append-only log

## 2026-07-17 — Sprint kickoff (M0)

### D1 — Jakob's answers to §13 open questions (given at sprint start)
1. **Trust-edge format:** OpenVTC VRC shape is the alignment target. v0 keeps `trusted_peers.json`, but field naming should convert cheaply to VRCs.
2. **Marketplace:** later. Do not design for it now.
3. **Privacy rung 1+ cryptography:** deferred — Jakob worries about it later; Markus owns the crypto review. Document in PRIVACY.md, do not implement beyond [S1] flag.
4. **Hosting model:** default long-term = one VPS per user (users send an old PC to a foundation that hosts it for them). Until then: agent accounts on the community instance; before that exists: a globally federated instance. v0 sim mirrors "community instance" (one shared homeserver, one agent account per user).
5. **Exclusion:** individual-scale only, not group governance. Someone breaking my trust = I downgrade/remove them in *my own* trust graph. No appeals process (it is individual agency, not collective punishment). No notification to them that a downgrade or a second-brain note exists.
6. **Second-brain consent:** the noted person is NOT notified that the note exists. They ARE notified (consent ping) before their having a resource is told to someone else — i.e., at first relay attempt — **including the ability to attach their conditions for giving the item out**. This is exactly the two-hop consent chain (§6.1 relay); the consent reply must be able to carry a `conditions` text.

### D2 — "Zero knowledge in the next version" (Jakob, sprint start)
Two obligations adopted:
- **v1 target = zero-knowledge:** PRIVACY.md and the M5 handback report must commit to privacy rungs 1–2 (asker learns only the aggregate, provably; non-matching peers learn nothing) as the next-version goal — v0 stays honestly labeled NOT zero-knowledge (I7).
- **Zero-context handback:** the M5 handback report must be self-contained enough that a consumer with zero prior knowledge can pick up v1.

### D3 — Container runtime: podman substitutes for docker
Host has no docker; podman 5.8.2 + podman-compose present, VM `podman-machine-default` started. `docker compose` → `podman compose`. Makefile parameterizes `DOCKER ?= podman`. Gate treated as passed (functional equivalence); not stopping the sprint for a docker install.

### D4 — LLM models: use host ollama + existing models
Host ollama runs at `http://localhost:11434`. Doc's `qwen2.5:3b-instruct` / `bge-m3` are not pulled; substitutes that exist locally: `CHAT_MODEL=qwen3:4b`, `EMBED_MODEL=qwen3-embedding:8b` (multilingual — carries de↔en). Both are .env config values; compose still defines an in-stack ollama for the hermetic profile. Keyword fallback (§9) protects the demo regardless.

### D5 — Repo location
Sprint repo = `web-of-trust/Code/` (its own git repo, nested inside the personal monorepo; the parent tracks it as an untracked dir). Jakob created `Code/` right before invoking the sprint. Commits stay local (no public push).

### D6 — better-sqlite3 fallback
Node is v26. If `better-sqlite3` lacks prebuilds / fails to compile, agent-core falls back to the built-in `node:sqlite` module behind the same store interface.
