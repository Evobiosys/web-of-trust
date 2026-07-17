# 10 — UX Decision Log

The ratified design decisions behind the mockup, with the reasoning and the alternatives that were
turned down. These were made by the project owner in workshop sessions on 2026-07-17. If you're
proposing a change that touches one of these, read the "Rejected" line first — it's usually the
option you're about to re-propose.

## r1 — Gated events are fully invisible

- **Decision:** Outside the trust path, a private event doesn't render at all — no card, no hint.
- **Why:** "Knowing the right people to even see that the event exists" is the point. A teaser
  turns that into a FOMO mechanic and a velvet-rope signal, which is the opposite of the intent.
- **Rejected:** Veiled hint cards; a hybrid teaser-by-tier approach.

## r2 — Mixed voice

- **Decision:** Plain verbs carry functional UI ("Add someone you just met", "Connected",
  "Pending"). The weave poetry appears exactly twice: the mutual celebration ("Woven.") and the
  Your Web view ("you hold each other's thread").
- **Why:** Newcomers need zero learning curve on the functional path. One poetic beat is enough to
  keep the signature without asking people to learn a metaphor to use the app.
- **Rejected:** The weaving metaphor used everywhere; a fully plain register with no poetic beat at
  all; dance-native language like "circles" (it blurs the literal act of dancing with the trust
  act, which are two different things).

## r3 — Levels gate depth

- **Decision:** Hosts set a minimum closeness (tier) for a gathering, and connection level is
  checked by the visibility predicate — not just shown as a description.
- **Why:** This makes the trust gradient literal instead of decorative: deeper intimacy actually
  opens deeper rooms.
- **Rejected:** Descriptive-only levels (shown but not enforced); distance-only gating with
  hand-picked guest lists.

## r4 — Second ring shows only the willing

- **Decision:** A through-connection appears by name in your second ring only if that person's own
  visibility dial is on. Everyone else aggregates into "+N held privately."
- **Why:** Who-you-know is sensitive data. Consent comes first, but the web still needs to feel
  alive rather than empty.
- **Rejected:** Names by default (leaks contact graphs); counts-only with no names ever (the web
  feels dead, and introductions need an extra flow to work around it).

## r5 — Host-side create flow with live reach

- **Decision:** When a host picks a tier while creating a gathering, they see a live reach
  estimate and list update alongside it.
- **Why:** The trust gradient has to be demo-able from the host's side, not just the guest's — a
  live reach number makes the abstraction concrete instead of theoretical.

## r6 — Ladder rename + 4th rung

- **Decision:** The ladder is renamed and gets a fourth rung: Contact (dance-floor default, cards
  only) → Friend → Close friend, with the upgrade path treated as first-class. Tiers are renamed
  to match: Public / The Commons / Friends / Close friends.

## r7 — Offers browse in Discover, stewardship lives in You

- **Decision:** Browsing offers happens in Discover, as a "Gatherings | Offers" segment. Managing
  your own offers happens under You.
- **Why:** Browsing offers is community discovery; stewarding what you've put out into the world is
  personal. They're different modes and belong on different surfaces.
- **Rejected:** Offers living inside Your Web (that surface should stay contemplative, not
  transactional); a sixth tab (it crowds the center shutter).

## r8 — Activity overlay, not a tab

- **Decision:** A bell in the header opens a full-screen Activity overlay covering everything
  awaiting you: borrow requests, second-degree approvals, return confirmations, completion
  check-ins.
- **Why:** The loan loop is unbuildable without an inbox of some kind, but a full tab would
  over-promote what should be an occasional, notification-driven surface.

## r9 — Quiet introductions

- **Decision:** Introduction suggestions ("threads that could meet") live as cards under the rings
  in Your Web. Maximum 1–2 at a time, dismissable, never badge-counted, and never framed as coming
  from an automated system.
- **Why:** Suggestions are ambient tending of the web, not a task queue. Badging or counting them
  would turn a gentle nudge into pressure.

## r10 — Completions are relational, not reputational

- **Decision:** "Do you feel complete?" is asked of both parties at the end of a loan. It's private
  to the two of them. Unresolved incompleteness is visible only within each party's own
  Close-friend circle.
- **Why:** Completion is between the two people involved, not a public signal about either of them.
- **Rejected:** Star ratings; a public completion history (either one drifts toward a reputation
  system, which is explicitly out of scope — see the design-law constraints below).

## r11 — Share composer: level, channel, then Advanced

- **Decision:** The composer offers a level preset (Contact by default) and a channel choice (QR
  by default; NFC, AirDrop, or link also available), with an Advanced fold underneath for atomic
  permissions (e.g. limiting to the ecstatic context only, or choosing which sharing types apply).
  Advanced is skippable and adjustable later. Opening Meet with no other input still just shows
  your code — the zero-tap default is preserved.
- **Why:** Most people just want to share their card. The people who want fine-grained control
  should get it without slowing down everyone else.

## r12 — Asymmetry is allowed but never silent

- **Decision:** Visibility is symmetric by default, but one-way visibility is allowed. When it
  happens, it's always labeled ("⚠ sees you: no"), never left unmarked.
- **Why:** Forcing full reciprocity would mean giving up privacy just to retain sight of someone —
  that's the wrong trade. But an unlabeled asymmetry is a trust violation waiting to happen.
- **Rejected:** Enforced reciprocity; unlabeled asymmetry.

## r13 — Signup: Quick and Advanced, side by side

- **Decision:** Quick signup auto-stores keys on the device, unlocked by face or PIN. Advanced
  signup offers a recovery verse, a server choice, and a view-source link. Both are presented side
  by side with explainers, not as a hidden option behind the other.
- **Why:** A single mandatory seed-phrase path would deter the dance floor's least technical
  people — exactly the people this needs to work for.
- **Rejected:** A single mandatory seed-phrase path.

## r14 — Logged-out browse

- **Decision:** Public events are visible with no signup required. The join pitch, shown on a
  gated interaction, communicates member benefits: private gatherings through friends, offers,
  and your own web.
- **Why:** The public tier should actually be public — requiring an account to see public events
  would undercut the whole point of the tier.

## Design-law constraints (carried throughout)

- Ego rings, never global graphs.
- Named paths, never numeric trust scores.
- The handshake stays under 30 seconds.
- Success and failure states are unmistakable — no ambiguous middle state.
- No automated-system wording anywhere in the interface.
- No scores, streaks, or engagement metrics.
- Private means invisible, not locked.

## Open questions

- **RSVP semantics** — does RSVPing to an event reveal you to the host's web?
- **Level wording** — final copy polish on the ladder names.
- **Onboarding depth** — how much of the trust-graph model to explain up front vs. let people
  discover.
- **Amends flow design** — the restorative process placeholder needs community input before it's
  built out.
- **Tag permission defaults** — what a tag's blanket permissions default to, once tags ship.
