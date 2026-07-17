# 20 — Data Contract (UX → Backend)

What the mockup's behavior requires of the data layer, keyed by anchor IDs (see `docs/60-anchors.md`
and spec mode in the mock). This is the shared contract: change it here first, then change the mock
and the implementation to match (CONTRIBUTING.md). Where a mechanism is genuinely undecided, this
doc states the *observable requirement* and points to the ADR in `docs/30`.

## Trust ladder — the core enum
`ONB-*, CER-1, CER-4, PPL-1`

```
Level = contact | friend | close        (ordered: contact < friend < close)
```

- **contact** — cards exchanged, nothing else. No network visibility in either direction. The
  dance-floor default.
- **friend** — parties appear in each other's webs: friend-tier visibility (events, offers),
  second-ring discoverability (consent-gated, see §Consent).
- **close** — close-tier visibility, more intimate sharing, deeper resource permissions.
- Levels are **per-relationship and directional at capture** (each party states one), but gate
  checks use the **effective level** of the pair — resolution rule is OPEN (docs/30 ADR-2;
  recommendation: `min(a→b, b→a)`).
- Levels must be **upgradeable** ("grow it later") and downgradeable; every change is a new
  attestation event, not a mutation of history (revocation semantics: ADR-2).

## Handshake — relationship attestation
`CER-1..CER-5`

The in-person ceremony produces a **mutual attestation pair**. Requirements:

- **Payload** (CER-3), carried identically by QR / NFC / AirDrop / link: initiator identifier
  (DID), display name, encryption public key, nonce, timestamp, **offered level**, and the
  permission atoms preselected in the composer (§Permissions). Must work **offline**: acceptance
  may be queued (outbox) and delivered when connectivity returns.
- **Confirmation** (CER-4): the accepting party sees name + avatar and confirms the *human*, then
  picks a level (preselected to the offered level). **Event context is auto-attached** when the
  handshake happens at a known event ("met at Ecstatic Dance Palermo, 2026-07-17") — context is a
  claim in the attestation, not decoration.
- **Mutuality** (CER-5): the relationship is `pending` until the counter-attestation arrives
  (states: `none | pending(outgoing) | pending(incoming) | mutual`). Celebration fires only on
  `mutual`. One-scan-plus-accept must suffice (no double scan required).
- Target ceremony time: **under 30 seconds** end-to-end. Anything the crypto needs beyond the
  human confirmation must be invisible.

## Permissions — atomic grants
`CER-2, PLC-2/3`

Permission **atoms** attach per-relationship, set optionally at share time and adjustable later:

```
grant = { context_limit?: "ecstatic-dance",   // connection scoped to a community context
          offers_visible: bool,               // may see my offers at their level
          second_ring_visible: bool,          // may see my ring (interacts with §Consent)
          ...extensible }
```

- Defaults are permissive-within-level; the Advanced fold is **skippable** and everything is
  editable per person later (People → person sheet).
- `context_limit` supports **later widening** ("upgrade those permissions") — widening is a new
  grant, consented by the granter.
- Future: tag-based blanket grants (PLC-2/3, docs/70) sit ON TOP of atoms — per-person grants win
  over per-tag grants.

## Consent, second rings, and asymmetry
`WEB-3, WEB-4, YOU-2, HST-4`

- **The dial** (`YOU-2`): "show me to people my people trust." When ON, my name may appear in the
  second ring of people my connections connect with; when OFF I appear only inside aggregate
  counts ("+N held privately"). Per-person overrides via the relationship grant.
- **Symmetric by default; exceptions labeled** (`WEB-4`): visibility defaults to mutual. A party
  may go one-way private, but the UI must ALWAYS be able to render the asymmetry ("sees you: no")
  — so the data layer must expose, for any visible second-ring person, whether the reverse
  direction holds. Silent asymmetry is a contract violation.
- **Aggregate counts must not leak identity**: "+N" is safe only if N can't be diffed to reveal
  who toggled (implementation note for gossip design, ADR-3).
- **Reach lists** (`HST-4`): host-side previews show ONLY consenting people's names + a private
  count. Never enumerate non-consenting people to the host.

## Event visibility — the invisibility predicate
`DIS-2..DIS-4, HST-1..HST-5`

```
tier = public | commons | friends | close
visible(viewer, event) :=
  tier == public
  OR ( exists path viewer→host_circle
       with path_length ≤ event.steps          // default 2, host-adjustable 1..3 (advanced)
       AND every hop's effective level ≥ tier_minimum(event.tier) )
```

- `tier_minimum`: commons → contact; friends → friend; close → close.
- **Hard rule:** when `visible()` is false the item does not exist for that viewer — no locked
  card, no teaser, no count, no residue in search or map (`DIS-3`). Both list and map (`DIS-4`)
  use the same predicate.
- Location can be a **separately gated field** (an event may be visible while its exact location
  is released later / on arrival) — see mock's "shared on arrival".
- Public events must render to **logged-out viewers** with no identity at all (`DIS-5`).
- Where the predicate is EVALUATED (client, relay, service) is the biggest open decision:
  **docs/30 ADR-1.**

## Resources — offers, loans, completions
`RES-1..RES-6, YOU-3, ACT-*`

**Offer**: `{ item, description, owner, tier, steps?, extended_via?: [personId] }` — visibility
uses the SAME predicate as events (tier × path × level).

**Loan state machine** (`RES-4`):

```
available → requested → lent → returned → complete
                (owner accepts/declines)      (both parties check in)
```

- Requests are private to the owner (arrive as Activity items) — no public request state.
- Both parties transition independently; the record is double-entry (each side holds its copy) —
  offline consistency: ADR-11.

**Completion check-in** (`RES-5`): after `returned`, BOTH parties answer "Do you feel complete?"

```
completion = { loanId, party, felt_complete: bool, note?: text, ts }
```

- **Never numeric. No stars, no scores, no aggregate rating** — the record is relational memory.
- Visibility: a completion is private to the two parties. `felt_complete=false` records are
  additionally readable **only within the recording party's close-friend circle** (informing
  their own people's future lending decisions). Nothing is ever public or global.

**Second-degree extension** (`RES-6`): a friend may request to re-offer my item one ring further
*through them*:

```
extension = { offerId, via: personId, granted_by_owner: bool, revocable: always }
```

Borrow requests arriving via an extension still require **owner approval** per loan.

## Introductions
`INT-1, INT-2`

- **Suggestion inputs** (ADR-12 governs where computed): declared needs, offers, and the
  *non-adjacency* of two of my connections. **Explicit non-inputs:** message content, behavioral
  tracking, engagement signals of any kind.
- Presentation contract: max 1–2 quiet cards, dismissable, never badge-counted, no
  automated-system framing in copy.
- **Introduce flow** (`INT-2`): the introducer shares each party's card with the other — with the
  introducer's explicit act, and creating NO connection between the two. They connect only via
  their own in-person ceremony. (Card-sharing consent is implied by the card's existing share
  grant to the introducer; if absent, ask.)

## Activity
`ACT-1, ACT-2`

Item types: `borrow_request · extension_approval · loan_update (lent/returned) ·
completion_checkin · connection_pending · level_change`. Badge counts **only items awaiting the
user's action** — it is an inbox, not an engagement surface. No streaks, no red-dot bait, nothing
fires for passive events.

## Onboarding & keys
`ONB-1..ONB-5, YOU-1`

- **Quick path**: keys generated and held on-device (platform secure storage, biometric/PIN
  unlock), zero writing-down. **Advanced path**: 12-word recovery phrase + backup-server choice +
  view-source affordance. Both paths yield the SAME identity type — Quick can upgrade to Advanced
  later (custody mechanism: ADR-6; recovery: ADR-7).
- Display name is self-asserted, non-unique, editable. No accounts, no email/phone required.
- Guest mode requires **no identity**: public browse only.

## Cross-cutting fences (contract-level)

1. Nothing renders that the predicate denies (invisible, never locked).
2. No numeric reputation anywhere in any schema — booleans and prose only.
3. No "AI"/automated-system naming in any user-visible string.
4. Asymmetric visibility is always queryable so the UI can label it.
5. All relationship data is user-held and portable; servers see ciphertext (see docs/40).
