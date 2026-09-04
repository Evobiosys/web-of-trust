# Two-hop decisions: what "named introduction" and "the intermediary reads it" imply

This document continues `docs/query-traversal.md` and must not contradict it. It
takes two decisions the owner has already made and works out what they imply,
grounded in code that has actually been read, not in code that is planned.
Claims are marked SHIPPED, DESIGNED, or SPECULATIVE, following that document's
convention. Confidence is noted where below 0.9.

Two codebases are in scope and they are not the same codebase. `packages/
agent-daemon` implements a two-hop relay today, tested and run live
(`verification/alpha-run.txt` leg (g); DECISIONS.md D13/D15/D16/D17). `apps/
demo` does not yet: a two-hop demo (`feat/demo21`, worktree `wt-demo21`) is
being built while this document is written. Where a claim is true of one and
not the other, this document says which. Reading the daemon's shipped
mechanism as if it already describes the demo would be exactly the error the
brief for this document warns against.

## 0. The one honest sentence, up front

**Decision 2 breaks nothing that is written down as a promise about the
server. It breaks something the project has not yet had to say out loud: that
a human hop is not the same kind of thing as a relay hop.** The server
carries ciphertext it cannot read, in both the one-hop and the two-hop case,
and that stays true (§3). What was true of the *whole path* at one hop, "no
one in the middle can read this," stops being true at two hops, because the
middle is no longer a machine. Nothing in the code needs to change to make
this true; it already is, the moment a human forwards a plaintext question to
another human. What has to change is that the app has to say so, on screen,
before B sends (§3).

The two decisions do not, on inspection, threaten I3 (Indistinguishable No)
in the way "does A reading the content break the anonymity floor" might
suggest. They threaten something narrower and more concrete: elapsed time to
any terminal outcome becomes a hop-count oracle, in a way that is already
latent in the one-hop design and that two hops make load-bearing (§4). And
they surface an asymmetry the owner may not have intended: Jakob, the person
actually asked to decide, is given no signal that he is deciding on behalf of
a stranger rather than for his friend A (§5). Both are real findings, not
footnotes.

## 1. The decisions, stated precisely

Proposed as `DECISIONS.md` D23 and D24 (not appended here; see the report for
the exact entries to paste in). Cited by the numbers they build on: D1.5, D1.6,
D13, D15, D16, and invariant I8 (`CLAUDE.md`).

**D23: named introduction, not an anonymous answer.** When B's question,
carried by A, is answered by Jakob, B is told it was Jakob, and the
introduction only happens because Jakob's own consent produced it. This is
not a new mechanism to build for `packages/agent-daemon`: it is already what
`relayHandleConsent` does (`daemon.ts:601-643`). The 3-party room it creates
(`createSharedRoom([relay.upstream_requester, relay.noted_owner,
this.cfg.peerId])`, `daemon.ts:616`) carries Jakob's real peer id and display
name in `RoomRecord.peers` (`daemon.ts:620-627`), and `sanitize.ts`'s
`buildStateSnapshot` exposes that `peers` array verbatim to every room member,
B included. There is no field anywhere in `ConsentBodySchema` or
`IntroBodySchema` (`packages/protocol/src/envelope.ts:47-57`) that would let
Jakob consent to answer while withholding his name from the room he is placed
in. **So D23 is not a choice being exercised so much as a description of the
shipped mechanism's only shape**, confidence 0.85. `apps/demo` has no
equivalent room concept yet (§4); demo 21 has to invent one, and D23
constrains what it may look like.

**D24: the intermediary sees what she carries.** A, relaying B's question,
can read the question text and, once it resolves, the answer. In `packages/
agent-daemon` this is not a new permission being granted, it is the absence of
one being withheld: A's own `IncomingRecord.text` already stores `env.body.text`
in the clear (`daemon.ts:408`), and the whole protocol is unencrypted at the
transport layer in v0 (D8, "Agent DM rooms are E2EE-capable in design, NOT
encrypted in v0"). D24 states the daemon's existing default as deliberate
policy rather than leaving it as an accident of D8's deferral. In `apps/demo`, D24 is a real,
consequential design choice, not a default: the demo's one-hop crypto
(`relay.ts`, `crypto.ts#derivePairKey`) is built specifically so the relay
*cannot* read content, and a second hop through a human relay has no reason to
inherit that same property automatically. D24 says it should not: A decrypts
with her own pair key to B, reads, and (if she forwards) re-encrypts with her
own pair key to Jakob. Confidence 0.9 this is what D24 requires structurally,
given `apps/demo` has no multi-party key at all (only pairwise
`derivePairKey`, `apps/demo/src/relay.ts` header).

I found nothing in either codebase that D23 or D24 breaks outright. What they
do strain is stated in §4 and §5.

## 2. What each person learns

Grounded in the shipped daemon mechanism (`daemon.ts`, `sanitize.ts`) unless
marked DESIGNED for the `apps/demo` target. "Infer, not told" is the column
that matters, per the brief.

| Person | Knows before | Learns from the question | Learns from a successful answer | Can infer, never told |
|---|---|---|---|---|
| **B** (asker) | A exists and is trusted (edge to A). Does not know Jakob exists. | Nothing about Jakob. Sees own ask go `open` -> `waiting` (I2, `sanitize.ts`'s `askerStateToApi`, `daemon.ts:277-315` `askerHandleStatus`). | Jakob's name and peer id, via `RoomRecord.peers` (`daemon.ts:620-627`), and the room's `context` string, which literally names A as the one who made the introduction, appending `"introduced by ${A's name}"` (`daemon.ts:614`). Also learns, structurally, that A privately held knowledge about a third person (`query-traversal.md` §2, "Does the design leak something across hops"). | On a "waiting" outcome that never resolves, nothing about *why* (§4). But, per §5, can infer that A holds some private second-brain notes at all, the moment any relay ever succeeds; this is intrinsic to the room model, not a bug. |
| **A** (intermediary) | B (asker), Jakob (noted owner), and that she privately noted something Jakob has (her own `Item.provenance.kind === "second_brain"`, `daemon.ts:946-958`). | The full question text (D24; `daemon.ts:408`). Decides, having read it, whether to forward at all (D16 guard, `daemon.ts:372-380`; her own consent/decline, `daemon.ts:468-495`). | The full answer content, since she is a room member (`daemon.ts:616`, her own `this.cfg.peerId` is in the `createSharedRoom` call). She also always knows, necessarily, that she relayed, because she is the one who granted the consent that caused it (I6-audited, `relay_forwarded`/`relay_room_created`, `daemon.ts:576-582`, `636-642`). | Nothing new beyond what she already read; she is the fullest-informed party of the three at every stage. |
| **Jakob** (noted owner / answerer) | Only that A is a trusted peer. Does **not** know a note about him exists at A's (D1.6: "the noted person is NOT notified that the note exists"), and does not know B exists. | The question text, but attributed to **A**, not B: the downstream `REQUEST` he receives is transport-authenticated `from = A`'s peer id (`daemon.ts:584`, `handleEnvelope(from, env)` at `daemon.ts:1082`), and `RequestBodySchema` (`envelope.ts:30-39`) has no field for an upstream requester at all. His own `ownerHandleRequest` therefore builds a consent card that reads, to him, as an ordinary direct question from A (`daemon.ts:403-417`, `requester_peer: from`). **He has no signal that this is a relay when he decides**, confidence 0.9; see §5. | B's identity, via the same room `peers` array, delivered by the same `INTRO` message that only goes out *after* his `CONSENT` has already been sent and processed (`relayHandleConsent`, `daemon.ts:601-643`: his `INTRO` is the last of three sends, line 634, after both messages to B). So he learns who he actually helped only after he has already committed to helping. | That A had a reason to bring this specific stranger's question to him; nothing more specific than that is on the wire, but nothing stops A from saying more out of band (§5). |

Two things in this table are not answers to the brief's stated questions, and
are called out because they were not visible without reading the code:
Jakob's blindness to B's existence while deciding, and the order in which his
own `INTRO` arrives relative to his `CONSENT`. Both follow directly from D23
and D24 as shipped, and neither looks intended.

## 3. The sentence that has to appear, and where

The project already has the model for this sentence: `i18n.ts`'s
`relayExplain` (`apps/demo/src/i18n.ts:287-294`), written for the one-hop
relay server, with a comment above it warning that dropping any of its three
clauses overclaims. The two-hop sentence needs the same discipline, and it is
a *different* sentence, not an edit to that one: `relayExplain` is about a
machine (the relay server) and stays true. The new sentence is about a person.

**German** (register matched to `relayExplain` and to `i18n.ts`'s existing
"Grätzl" tone):

> Deine Frage geht nicht direkt an [Jakob]. [A] bekommt sie zuerst zu lesen
> und entscheidet, ob sie sie weitergibt. Wenn sie das tut, sieht sie auch die
> Antwort. Der Server sieht in beiden Fällen nur unlesbaren Text; [A] nicht.

**English:**

> Your question does not go straight to [Jakob]. [A] reads it first and
> decides whether to pass it on. If she does, she also sees the answer. The
> server still sees only unreadable text either way; [A] does not.

Three clauses, matching `relayExplain`'s own discipline: the server's
guarantee is unchanged (clause 3, keeps I7 honest); A is a reading,
deciding party, not a pipe (clauses 1-2); and the two are explicitly
contrasted so a reader cannot round "the relay can't read it" up to "no one
can."

**Placement, both required, not optional:**

1. On B's own ask screen, **before B sends**, wherever demo 21 places the
   toggle or button that lets the question travel a second hop. This is a
   consent-affecting fact, not a status update: it changes whether B wants to
   ask at all, so it cannot arrive only after the fact (compare `relayExplain`,
   which appears on the "Verbinden" flow before any query is sent,
   `i18n.ts:287-294`'s comment).
2. On A's own screen, at or before the moment she is shown B's question and
   asked whether to forward it. She is being told, plainly, that she is about
   to read a stranger's question and, if she says yes, her friend's answer to
   it. This is D24 made legible to the one person it actually constrains.

Demo 20's existing copy, which correctly says a link-joiner can query only
that one device and never further, is **not** touched: that claim stays true
in demo 20's own scope and the handover for demo 21 is explicit that demo 20's
copy is out of bounds.

## 4. Whether the indistinguishable no survives

The brief names four reasons B can get nothing: (a) A had no one to forward
to, (b) A declined to forward, (c) Jakob declined, (d) Jakob had nothing.

**The headline is not "two hops break I3."** I3 as written (`CLAUDE.md`) is
scoped to the wire: "declined vs no-match = byte-identical `PASS` wire
messages on a uniform reply schedule." That guarantee holds at each hop
individually, and holds across the relay path too, for a reason worth stating
plainly: **once B's ask reaches `PENDING`, nothing downstream can change *when*
or *how* B is told "no."** `resolveAskOnTtl` is scheduled once, at `sendAsk`
time, from B's own `ttlMs` (`daemon.ts:148-193`, the `scheduler.scheduleAt`
call at line 189). `forwardRelay` reads `this.cfg.defaultAskTtlMs` to set the
*downstream* request's own TTL for Jakob (`daemon.ts:584`), which governs
Jakob's record, never B's. Whether A declines slowly, or forwards and Jakob
declines, or forwards and Jakob has nothing, none of it sends B a second
message: D15 made this explicit, stating that a resolved-downstream relay
"sends NOTHING further upstream" (`relayHandleStatus`, `daemon.ts:663-680`),
and a slow direct decline is silent for the identical reason, stated in the
code's own comment: once PENDING has already gone out, a later decline sends
nothing further at all (`decline()`, `daemon.ts:484-495`). All three of
(b, slow), (c), and (d) degrade at the exact same moment: B's own
`created_at + ttl_ms`, checked at the view layer (`sanitize.ts`'s
`askerStateToApi`, "pending" -> `no_one_this_time` once past deadline).
**Inside that group, the no really is indistinguishable, confidence 0.9.**
This is the property the pitch rests on, and it survives.

**What does not survive is something adjacent and more general: elapsed time
to *any* terminal outcome is a hop-count oracle, in both directions, not only
on "no."**

- A *fast* no (within `statusDelayMs`, default 30s, `config.ts:47`) can only
  ever mean the question resolved without leaving A's own device: a genuine
  no-match, or D16's "noted owner unreachable" fold-in (reason a, byte-
  identical to no-match by construction, `daemon.ts:372-380`), or a fast
  explicit decline (reason b, if A decides inside the 30-second window). None
  of these can involve Jakob at all, because reaching Jakob requires A's own
  `finalizeConsent` to fire, then `forwardRelay`'s `transport.send`, then
  Jakob's *own* `statusDelayMs` clock to run before he sends anything back
  (`daemon.ts:557-585`, `437-466`). A relay cannot resolve inside one hop's
  own uniform window; it is structurally slower. So a fast `PASS` is,
  observationally, "this never left A," and a `PENDING` that lingers is,
  observationally, "this reached, or is still travelling to, hop 2." Byte-
  identical, timing-distinguishable. Confidence 0.85 (the boundary softens
  exactly at the case where A takes just under 30s to decide either way, which
  looks identical whichever way she decides, but that case is itself rare by
  construction, since 30 seconds is not much time to read a stranger's
  question and decide whether to hand it to a friend).
- The same asymmetry exists on the *yes* side, and the brief did not ask about
  it, which is why it belongs here rather than being assumed away: a direct
  `completeConsent` fires synchronously the moment A (or B, for a direct ask)
  consents (`daemon.ts:497-523`). A relay's `relayHandleConsent` cannot fire
  until Jakob's own `CONSENT` arrives, which needs his own `statusDelayMs`
  round trip at minimum (`daemon.ts:601-643`). So a room that opens fast was
  never relayed; a room that opens only after a longer wait was. The general
  statement, not the narrower "no-only" one the brief posed, is the accurate
  one: **hop count is legible from elapsed time to *any* terminal state**, yes
  or no. This is not a new leak introduced by D23/D24; it is a property of
  the uniform-delay mechanism (I3) applied to a two-stage process instead of
  a one-stage one, made visible only once a second hop exists to compare
  against. SHIPPED at the daemon layer (the mechanism exists and is
  unit-tested for the no-case, D15/D16's test suites), DESIGNED as an analysis
  (no test in this repo currently asserts the yes-side timing claim; confidence
  0.8 that it holds as reasoned, pending a timing test the way D15 has one for
  the no-case).

**What A's own behaviour can leak, separate from the wire.** D24 makes A a
knowing, reading party, in an ongoing relationship with B (they are already
trusted contacts). Nothing in the protocol stops A from simply telling B, out
of band, "I asked my friend and he said no," or "I decided not to bother him,"
or staying silent in an unrelated chat thread while the app shows "waiting."
This is not new *in kind*: at one hop, A could always tell B "I don't have it"
versus staying silent, and the protocol never tried to prevent that, because
I3 is stated as a wire property, not a promise about human speech. What *is*
new is that A's out-of-band speech now implicates **a third party who never
agreed to it**: "I asked Jakob and he said no" discloses Jakob's existence and
his refusal, and D23 only governs naming on *success* (Jakob's own consent is
what produces the introduction). Nothing in the design gives Jakob a say over
whether A discloses a *decline* on his behalf. This is a real gap and it is
not closable in code: the fix, if the owner wants one, is social (ask A not
to), not technical (there is no chokepoint on a phone call). Confidence 0.9
this gap exists and 0.6 that it is worth spending anything on, since it is a
strict superset of a leak every messaging app with human intermediaries
already has.

**The fork this creates for `apps/demo` (demo 21), stated as a decision the
build has to make, not a recommendation snuck into a design doc:**
`packages/agent-daemon` can hide the fast/slow tell behind a real async
"waiting" state that a person can walk away from for hours (the ask's `ttl_ms`
defaults to 24h, `config.ts:49`). `apps/demo` has no such state: `gate.ts`'s
`AnswerEnvelope` is a fixed `ANSWER_BODY_LEN`, one tag byte, `0x00` nothing or
`0x01` shared (`gate.ts:18`, `types.ts:275`), sent and interpreted in a single
round trip B is watching happen, with a 180-second client-side deadline
(`RELAY_ANSWER_TIMEOUT_MS`, `apps/demo/src/main.ts:599`) and a live spinner
(`relayAskInFlight`, `askOverRelay`, `main.ts:2152-2189`). There is no
representation in that model for "still travelling to hop 2." Demo 21 has
exactly two honest options, and no third: (1) invent a new waiting state, which
is a new observable that needs its own indistinguishability argument from
scratch, since it did not exist in the one-hop demo at all; or (2) hold B's
answer until hop 2 resolves inside the existing single round trip, which makes
elapsed real time *directly* the oracle, with no uniform 30-second mark to
blur it against, the way the daemon has. Whichever is chosen, an honest demo
would need a genuine one-hop "nothing" to take *roughly as long* as a two-hop
one, or the spinner itself becomes the tell regardless of anything on the
wire. This is not solved here; it is the single most consequential open
question for whoever builds demo 21, and it did not exist before this document
looked for it. Confidence 0.85 this is the real fork, not just one framing of
it.

## 5. What a named introduction costs

**Not reciprocal, and the asymmetry is not the one the brief's phrasing
suggests.** B learns Jakob's name and that A knows him (§2's table). The
brief asks whether Jakob learns who B is before deciding, and whether he
should. Grounded answer: **no, he does not, and not by omission of one field
that could trivially be added.** The downstream `REQUEST` he receives is
transport-authenticated as coming from A (`daemon.ts:584`, `handleEnvelope`
`from` parameter), and `RequestBodySchema` has no upstream-requester field at
all (`envelope.ts:30-39`). Jakob's own consent card is built exactly as if A
herself were asking (`daemon.ts:403-417`). He commits to answering, or not,
with strictly less information than B eventually gets about him. And the
`INTRO` that would tell him who he actually helped is sent to him *last*,
after his `CONSENT` has already gone out (`relayHandleConsent`,
`daemon.ts:632-634`: B's `CONSENT` and `INTRO` are sent first, Jakob's `INTRO`
third). **Should he know first?** Taking a position: yes, he should learn at
minimum that the question is being relayed on someone else's behalf, before
he decides, separately from learning who that someone is. He does not need
B's identity to make an informed choice (that would just invert the current
asymmetry onto B, plausibly worse, since B is the one who started this on
purpose and Jakob did not), but he does need to know his answer is not staying
inside his existing friendship with A. Answering "for A" and answering "for a
stranger A brought to me" are different acts of trust, and the protocol
currently cannot represent the difference to him at decision time. This is
the clearest unintended consequence found in this review: D24 makes A a
knowing party by design; the shipped mechanism makes Jakob an *unknowing* one,
and nothing in the two decisions asked for that.

**What happens if Jakob declines to be named.** There is no such state to
decline into, and this is worth being direct about rather than describing as
an edge case. `ConsentBodySchema` and `IntroBodySchema` (`envelope.ts:47-57`)
have no field that would let Jakob's `CONSENT` mean "yes, share it" while his
presence in the room stays withheld: consenting *is* being named, because the
room's `peers` array (`daemon.ts:620-627`) is the only channel through which
his consent becomes visible to anyone, and it always carries his real peer id
and display. **Position: named or nothing, as shipped**, because building an
anonymous-answer branch is new protocol surface, not a configuration flag.
The nearest existing precedent for what that branch would need is
`packages/network-access`'s Gate 2 (`DECISIONS.md` D19/D20): a k-anonymized or
identity-blind aggregate is one event, and `reveal_identity` is a separate,
later, explicit one. That package is explicitly "no daemon coupling yet" (D19)
and answers a different question (an aggregate over the owner's own contacts,
not a forwarded question to one named person), so it is not a drop-in, but it
is the shape a decoupled "consent to answer, without consenting to be named"
mechanism would have to take if the owner ever wants that branch. Confidence
0.85 that named-or-nothing is the correct reading of what is shipped, 0.7 that
it is also the right default to keep, since Gate 2's precedent suggests the
owner has, elsewhere, wanted the decoupled version.

## 6. The smallest thing that would test whether people want this

Not a new toggle, and not a new build. The two decisions this document works
out add exactly one new fact worth measuring: **A now reads the actual
content before deciding whether to relay it**, where the shipped mechanism
today lets that decision happen with zero friction added by this document's
own findings. The audit trail already records both outcomes distinctly and
locally (I6): `consent_card_created` / `auto_forward_consent` for a relay-
eligible card being offered to A, and `relay_forwarded` once she actually
consents (`daemon.ts:419-422`, `576-582`). **The single number:** of the
relay-eligible cards A is ever shown, what fraction does she actually forward,
versus decline or let expire. This requires no code change, no UI, and no new
parameter, only reading the existing local audit log across however much
alpha usage accumulates. It answers the question this document's two decisions
actually raise, "does making A a knowing reader change whether she is willing
to vouch for a stranger to a friend," without building a second thing to
measure it with. If that number turns out low, the fast/slow timing leak in
§4 matters less in practice, because relays will be rare regardless; if it
turns out high, §4's fork stops being optional for demo 21 and becomes the
next thing to fix.
