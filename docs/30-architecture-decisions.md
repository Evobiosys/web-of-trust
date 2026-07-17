# 30 — Architecture Decisions (all OPEN — the implementation team decides)

Each ADR: context → options → a recommendation from the UX side → **status: OPEN**. Close one by
editing it with the decision, date, and who decided. The mockup and `docs/20` state *observable
requirements*; these ADRs are the *mechanisms*. Nothing here is pre-decided.

Reference stack throughout: Anton's `real-life-org/web-of-trust` (`@web_of_trust/core` — did:key,
Ed25519/X25519, ECIES, JWS verifiable credentials, Yjs/Automerge CRDT storage, IndexedDB,
relay/vault/profiles services) and `real-life-org/real-life-stack` (connector-based UI toolkit).
Also referenced: the First Person Project white paper (LF Decentralized Trust — PHC/VRC model,
pairwise DIDs, ZKP proofs) and Berkman Klein ASML's `keyring-wallet` (alpha; Aries/Credo stack,
VRC + witness protocol, PIN/secure-enclave key custody).

---

## ADR-1 · How does an invisible event reach eligible eyes?
**Context.** The invisibility rule (20 §Event visibility) demands that non-eligible viewers see
*nothing*. Someone or something must evaluate `visible(viewer, event)` — but the reference stack's
principle is that servers only see ciphertext, and the predicate needs graph knowledge (path +
levels) that no single client holds.
**Options.**
(a) **Service-filtered:** an index service holds event metadata + enough graph to filter per
viewer. Simplest; breaks ciphertext-only; the service learns the graph.
(b) **Encrypt-to-eligible:** host's client encrypts the event to eligible members' keys. Pure E2E;
but "friends-of-friends I've never met" can't be enumerated client-side without the same graph
knowledge, and reach changes (new handshakes) require re-encryption/rekeying.
(c) **Prove-to-unlock:** viewer proves a qualifying path (ultimately a ZKP, FPP-style
"≥ level within N steps") and the host's side releases the event. Most honest to the vision;
real R&D; push-discovery becomes pull.
**Recommendation.** (a) for the prototype with an explicit honesty note, shaped so the client API
looks like (c) — `requestVisible(proof?)` — letting the mechanism harden later without UI change.
**Status: OPEN.**

## ADR-2 · Level semantics: disagreement, upgrades, revocation
**Context.** Levels are stated by each side and gate real access (20 §Trust ladder). Sides can
disagree; relationships deepen and sour.
**Options.** Effective level = min() of the two directions (conservative) vs. per-direction gating
(A's events use A→B's stated level) vs. negotiated single value at handshake.
**Recommendation.** min() for anything that grants access; store both directions verbatim;
upgrades = new mutual attestation (both confirm), downgrade/revoke = unilateral, takes effect
immediately for the revoker's own gates. Every change is an event, never history rewriting.
**Status: OPEN.**

## ADR-3 · Consent + asymmetry in graph gossip
**Context.** Second-ring visibility runs on shared graph knowledge (reference stack: gossip /
graph-cache). The dial (20 §Consent) and the symmetric-default/labeled-exception rule must be
honored *in the gossip layer*, and "+N held privately" must not be diffable to identify people.
**Options.** Client-enforced flags carried in gossip (trusting clients) vs. not gossiping
non-consenting nodes at all (counts become estimates) vs. relay-enforced filtering (relay learns
the graph).
**Recommendation.** Don't gossip non-consenting identities at all; carry only aggregate counts
with coarse buckets (e.g., "+a few / +many") if exact N is diffable. Be honest in docs that a
malicious client is not preventable — the social layer (in-person trust) is part of the security
model.
**Status: OPEN.**

## ADR-4 · Where do events and offers live?
**Context.** ecstatic.world's current prototype (Supabase) already holds public events. Private
events/offers belong to the trust layer. The reference stack's CRDT "Spaces" could model an
event's room.
**Options.** Hybrid (public events stay Supabase; gated items in the WoT layer; one Discover UI
merges) vs. all-in CRDT from day one vs. all-in Supabase with ACLs (abandons E2E).
**Recommendation.** Hybrid for the prototype — it matches the "prototype now, permanent
decentralized stack next" posture and de-risks the demo; design the Discover merge so the source
is invisible to the UI (connector interface).
**Status: OPEN.**

## ADR-5 · Standards posture
**Context.** Three families in play: Anton's pragmatic stack (did:key + JWS VCs — shipping now);
FPP/LF Decentralized Trust direction (SCIDs, pairwise DIDs, VRC/PHC, ZKPs — where the ecosystem
is heading); Aries/Credo (keyring-wallet — heavy, mobile-native, alpha).
**Options.** Build on Anton's as-is · adopt Aries stack · Anton's now with credential shapes kept
field-mappable to FPP VRCs (context, datestamp, level, personas-later).
**Recommendation.** The third. Do NOT adopt keyring-wallet's code (platform mismatch, alpha,
2-person bus factor) — treat its witness protocol + the FPP/DTG specs as the interop target the
credential schema should be translatable into.
**Status: OPEN.**

## ADR-6 · Quick-signup key custody
**Context.** Onboarding promises a zero-writing quick path (20 §Onboarding). The reference stack
is BIP39-mnemonic-first; keyring-wallet demonstrates the alternative: PIN→Argon2→derived key in
platform secure storage (Keychain/Keystore), biometric-gated, no phrase.
**Options.** Mnemonic-always (hidden until requested) vs. secure-enclave custody with phrase
generated-but-deferred ("upgrade anytime") vs. custodial escrow (rejected — violates sovereignty).
**Recommendation.** Generate the BIP39 seed either way; Quick = store it encrypted under a
device-secure-storage key + biometrics and defer showing the phrase; Advanced = show phrase +
server choice up front. One identity type, two reveals.
**Status: OPEN.**

## ADR-7 · Recovery
**Context.** Quick-path users have written nothing down. Reference stack: mnemonic re-entry +
encrypted vault. keyring-wallet: password-protected export file. Research strongly favors social
recovery for this audience — and it's thematically perfect (your people restore you).
**Options.** Vault + mnemonic (status quo) · export-file · social recovery (threshold of close
friends re-attest/release shares).
**Recommendation.** Vault + mnemonic for the prototype; put social recovery on the v2 path as a
first-class design goal (it composes with the Close-friend tier).
**Status: OPEN.**

## ADR-8 · Packaging
**Context.** The ceremony needs a camera QR scanner (in-browser scanning is unreliable on iOS
Safari), NFC/AirDrop channels need native APIs, and festivals mean offline. The reference stack
already has a Capacitor (iOS/Android) pipeline incl. a native scanner plugin and F-Droid builds.
**Options.** PWA-only · Capacitor native (reuse Anton's pipeline) · both (web for browse/demo,
native for the ceremony).
**Recommendation.** Capacitor for the pilot (TestFlight + APK); keep the web build for logged-out
browse and desktop demos. NFC/AirDrop are progressive enhancements over the QR/link payload.
**Status: OPEN.**

## ADR-9 · Personas
**Context.** FPP persona DIDs (public / community / private personas) map to a real EW need
eventually (public artist identity vs. private dancer identity). Nothing in the reference stack
supports personas today.
**Recommendation.** Single persona for the prototype; keep the identifier layer able to add
persona DIDs later (don't hard-bind profile data to the root DID in schemas you'd have to
migrate).
**Status: OPEN.**

## ADR-10 · Witness protocol
**Context.** Berkman's keyring-wallet demonstrates a third-party "witness" service attesting that
an in-person exchange happened, without seeing its content — interesting for event-anchored
handshakes (the event itself could witness "these two met here").
**Recommendation.** Not for the prototype; note as a v2 candidate that would strengthen the
event-context claim from self-asserted to witnessed.
**Status: OPEN.**

## ADR-11 · Loan-state consistency
**Context.** The loan machine (20 §Resources) is double-entry across two offline-capable devices;
transitions (lent, returned) can be recorded by either side out of order.
**Options.** CRDT per loan (both sides converge) vs. owner-authoritative record with borrower
acks vs. simple last-writer-wins (rejected: loses check-ins).
**Recommendation.** Owner-authoritative for state transitions + independent per-party completion
records (they never conflict by construction — each party only writes their own).
**Status: OPEN.**

## ADR-12 · Where introduction suggestions are computed
**Context.** Suggestions match declared needs/offers across non-adjacent connections (20
§Introductions). Contract: no content mining, no behavioral signals, and no "AI" framing in the
product. A relay-side matcher sees needs/offers in cleartext; an on-device matcher only sees what
the user's own web already shares with them.
**Options.** On-device only (privacy-clean; limited to my visible ring) vs. relay-side matching
(wider; server learns needs) vs. opt-in shared "notice board" space per community.
**Recommendation.** On-device only for the prototype — every input is data the user can already
see, so the feature adds zero new disclosure. Revisit if match quality disappoints.
**Status: OPEN.**
