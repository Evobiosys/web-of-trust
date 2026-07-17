# 40 — Infrastructure (explainer only — HOLD OFF)

**⚠️ HOLD OFF — do not stand up infrastructure yet.** This doc exists so the team
knows the likely shape. Architecture decisions in
[docs/30](docs/30-architecture-decisions.md) must close first (esp. ADR-1 event
visibility, ADR-4 storage, ADR-5 standards posture).

---

## The reference stack

The prototype's architecture is built on Anton Tranelis's open-source
[`real-life-org/web-of-trust`](https://github.com/real-life-org/web-of-trust): offline-first
and client-heavy, with servers that only ever see ciphertext.

Three small self-hostable Node.js + SQLite services handle the backend. Docker deploy
configs live in that repo's `deploy/` directory:

### Relay

**Purpose:** WebSocket message relay for delivering encrypted attestations and messages
between phones.

**Behavior:** Phones queue an outbox when offline; the connection dance requires no
persistent wifi. A public instance exists at `wss://relay.utopia-lab.org`.

### Vault

**Purpose:** Encrypted backup store (ciphertext only) enabling device recovery.

**Behavior:** When you sign up on a new device, the vault fetches your encrypted state
and restores it locally. Only ciphertext leaves your device.

### Profiles

**Purpose:** Optional public-profile service for the logged-out and public surface.

**Behavior:** Signed profiles (cryptographically committed by their owners) are served
here; the public About page queries this service for each person's declared context.

---

## What NOT to do yet

- No EW-branded relay/vault/profiles deployments.
- No domain, TLS, or hosting decisions.
- No federation setup.

For early demos, use the public instances (`relay.utopia-lab.org`) or spin up local dev
instances from the upstream repo.

---

## When the time comes

Expect these patterns:

- **Hosting:** Small VPS-class servers (DigitalOcean, Hetzner tier); boring and cheap.
- **Deployment:** Docker Compose, SQLite persistence, self-contained.
- **UX:** "Advanced signup" offers a server-choice UI pointing at whichever instances
  exist (federation as a user choice, not a network topology problem).
- **Sequencing:** Multi-community federation is a later conversation. Start with one
  instance per deployment context.

---

## Cost discipline

This project values boring infrastructure. Prefer self-hosted over managed, SQLite over
PostgreSQL (until you have 10K+ concurrent users), and $5/month over $500/month. The
early community doesn't need elastic scaling.
