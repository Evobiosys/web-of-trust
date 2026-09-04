# Result report: two-hop design decisions

Deliverable: `docs/two-hop-decisions.md`. Pointer added to
`docs/query-traversal.md`'s tail. Nothing else was changed; no code touched.
`feat/demo21`'s worktree (`wt-demo21`) was inspected read-only (`git status`,
`git log`) to confirm it is mid-flight and to scope which claims belong to
`apps/demo` versus `packages/agent-daemon`. Its uncommitted diff was not read
in depth, only its list of touched files.

## The one thing that mattered most

Decision 2 does not break the server's promise; the server still never sees
plaintext, one hop or two. It breaks an implicit promise the project has
never had to state explicitly: that *no one* in the middle can read the
message. That was true when the middle was a relay server. It stops being
true the moment the middle is a person, by the owner's own choice, and the
UI has to say so before B sends, not after. `docs/two-hop-decisions.md` §0
and §3 give the exact sentence (German + English) and the two places it has
to appear.

## Position taken on each open sub-question

- **Do the two decisions break anything?** No invariant breaks outright. What
  strains is I3's *spirit* extended past the wire: elapsed time to any
  terminal outcome (yes or no) becomes a hop-count oracle, because a relay
  cannot resolve inside one hop's own uniform delay window. The wire-byte
  guarantee inside the "silent no" bucket (slow-A-decline, Jakob-declines,
  Jakob-has-nothing) holds exactly, confidence 0.9: none of those three ever
  produces a second wire message, and all three degrade at the asker's own
  TTL, set once at ask time and untouched by anything downstream. What does
  not hold is the boundary between "resolved fast" and "still pending":
  reaching hop 2 always takes at least one more `statusDelayMs` round trip
  than resolving at hop 1, so a fast PASS reliably means "never left A" and
  a lingering PENDING reliably means "reached, or is travelling toward, hop
  2." Byte-identical, timing-distinguishable. This generalizes past "no": a
  fast room-open was never relayed, a slow one was. Full reasoning and code
  citations in §4.
- **Does the design let B distinguish the four reasons?** Not from wire bytes
  or from the eventual outcome shape, inside the "nothing" bucket. From
  timing, partially: whether the nothing arrived fast (reasons a, or a fast
  b) or arrived only as silence after PENDING (slow b, c, d) is observable.
  Inside the second group, the three reasons stay genuinely indistinguishable
  from each other. From A's own out-of-band behaviour: yes, trivially, and
  this was already true at one hop for A's own inventory. What's new at two
  hops is that A's speech now implicates Jakob, a third party who never
  consented to that disclosure. Decision 1 only governs naming on success.
- **What does a named introduction cost?** Not reciprocal, and the asymmetry
  found is sharper than the one the brief's phrasing anticipated: Jakob is
  not told B's identity before deciding (expected, and defensible), but he is
  given **no signal that he is deciding on behalf of anyone other than A** at
  all. The downstream `REQUEST` he receives is transport-authenticated as
  coming from A, has no upstream-requester field, and his own consent card
  reads exactly like an ordinary direct question from his friend. His `INTRO`
  (which would tell him who he actually helped) arrives after his `CONSENT`
  has already gone out. Position taken: he should learn, before deciding,
  that the question is being relayed on someone else's behalf, without
  necessarily learning who, since that's a different act of trust than
  answering his friend directly. This is not something the owner asked for
  and not something either decision implies is fine; it looks like an
  oversight in what the relay mechanism actually discloses to its own
  answerer, not a deliberate asymmetry.
- **What happens if Jakob declines to be named?** There is no such state.
  Consenting and being named are the same act in the shipped mechanism: his
  consent is what puts his real peer id into the room's `peers` array, the
  only channel his answer travels through. Position: named or nothing, as
  shipped, because the alternative needs new protocol surface (a decoupled
  reveal step), not a flag. `packages/network-access`'s Gate 2 is the
  existing precedent for what that surface would look like if the owner
  wants it, but it's a different, unmounted package answering a different
  question.
- **The smallest test.** Not a new toggle. The audit log the daemon already
  writes locally (`relay_forwarded` vs. `consent_card_created`/decline for
  relay-eligible cards) already lets someone compute, after the fact, what
  fraction of the time A actually forwards once she can read what she's
  being asked to carry. No code change needed to start collecting the
  answer to the one question decision 2 actually raises.

## What follows from the owner's two decisions that he may not have intended

1. **Jakob decides blind to the fact that he is being asked on behalf of a
   stranger**, not just blind to which stranger. This is the strongest
   finding in the document (§5) and the one most worth the owner's attention
   before demo 21 ships copy that implies otherwise.
2. **A's mouth is an unclosable side channel for Jakob's decline**, not just
   for her own. Decision 1 names Jakob only on success; nothing in the
   design constrains what A says to B about a failure that involves Jakob's
   name. Flagged as real, not fixable in code, low priority (confidence 0.6
   it's worth spending anything on) since it's a strict superset of a leak
   every human-mediated messaging system already has.
3. **`apps/demo`'s synchronous, one-bit answer model (`gate.ts`) has no
   representation for "still travelling to hop 2" at all**, unlike the
   daemon's async ask/TTL model. This is a genuine fork for whoever builds
   demo 21, not a style note: invent a new waiting state (new observable,
   needs its own indistinguishability argument built from nothing) or hold
   B's single round trip open until hop 2 resolves (making elapsed real time
   directly the tell, with no 30-second uniform mark to hide behind, since
   the demo's client-side timeout is 180 seconds and the whole exchange runs
   in front of a live spinner). Neither option is free; the document does not
   pick one, because that's an implementation decision for the demo 21
   branch, not a design-doc decision.

## Invariant found under strain

Not I3's letter (the wire-byte guarantee holds, verified against code, not
assumed). I3's *unstated scope*: it was written, and is enforced, as a
property of the wire and the uniform dispatch schedule at one hop. Extended
naively across two hops, the same mechanism produces a new, legible signal
(elapsed time to any terminal state) that the one-hop version never had to
worry about, because there was only ever one hop's worth of delay to
compare against. Nothing was violated; something that used to be
unobservable became observable once there were two of it to compare.

## Proposed DECISIONS.md entries (not appended; for the owner to paste in)

```
### D23: named introduction, not an anonymous answer (two-hop relay, [owner], 2026-09-04)

When B's question, carried through A's relay, is answered by Jakob (the noted
owner neither A nor B originally shared a direct trust edge with -- Jakob and
B have never met), B is told it was Jakob by name, and this only happens
because Jakob's own CONSENT produced the room. This is not new engineering
for `packages/agent-daemon`: `relayHandleConsent` (daemon.ts:601-643) already
works this way, and there is no field in ConsentBodySchema or IntroBodySchema
(envelope.ts:47-57) that would let a noted owner consent to answer while
staying unnamed in the room his own consent creates -- so this decision is
better read as ratifying the shipped mechanism's only shape than as choosing
among alternatives. `apps/demo` (feat/demo21) has no equivalent room concept
yet and must build one consistent with this: named, or nothing (see D24's
note and docs/two-hop-decisions.md §5 for why an anonymous-answer branch is
new protocol surface, not a flag).

Unresolved by this decision, flagged for a follow-up: the noted owner
(Jakob) is given no signal, at decide-time, that the question he is being
asked is being relayed on someone else's behalf at all -- the downstream
REQUEST he receives is indistinguishable, on the wire, from A asking him
directly (daemon.ts:584, RequestBodySchema has no upstream-requester field).
See docs/two-hop-decisions.md §5.

### D24: the intermediary reads what she carries (two-hop relay, [owner], 2026-09-04)

A, relaying B's question to Jakob, may read the question text and, if the
relay succeeds, the answer. She is a knowing participant in the exchange,
not a blind pipe. In `packages/agent-daemon` this ratifies the existing
default rather than granting something new: the protocol carries plaintext
at v0 regardless (D8), and A's own IncomingRecord.text already stores the
question in the clear (daemon.ts:408). In `apps/demo`, this is a real
design choice with a real consequence for the app's own claims: the one-hop
relay (relay.ts) is built specifically so the relay server cannot read
content; a two-hop human relay has no reason to inherit that guarantee
automatically, and per this decision, does not. The claim "no one in the
middle can read this" stays true of the SERVER, at both one and two hops,
and becomes false of the INTERMEDIARY at two hops -- the app must say so, in
plain language, before B sends and on A's own forwarding screen. Exact
copy (German + English) and placement in docs/two-hop-decisions.md §3.
```

## Anything not closed

- No timing test in this repo currently asserts the "hop count is legible
  from elapsed time to any terminal state" claim for the *yes* side (the
  no-side has D15's test coverage; the yes-side is reasoned, not verified in
  a test, confidence 0.8). Worth a dedicated test the shape of D15's if the
  relay ships past alpha.
- The Jakob-blindness finding (§5) is a design gap, not a bug in shipped
  code behaving other than intended; it was not flagged in D13/D15/D16/D18,
  and this document does not resolve it, only names it and takes a position.
- `apps/demo`'s two-hop fork (§4, the waiting-state-vs-held-round-trip
  choice) is unresolved by design: it belongs to whoever is building demo 21
  right now, and resolving it here would be prescribing an implementation
  this task was not asked to write.
