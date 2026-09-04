# Result report -- demo 21 (a question that travels two hops)

Worktree: `../wt-demo21`, branch `feat/demo21`. Committed locally, not
pushed. Demos 1, 2, 3, 6 and 20 are untouched -- every change in this branch
is either additive (new files, new optional fields, new i18n keys) or gated
strictly behind `wotScenario() === 'secondHop'` and, for one small addition
to the shared consent card, `q.relayed === true` on top of that -- a
condition that is never true for any build before this one.

## Corrections since the first version of this report (read this first)

Several owner corrections arrived after this report was first written, two
of which reverse or materially change what is described below. Rather than
silently rewrite every paragraph they touch, they are recorded here as an
erratum, and in full in `DECISIONS.md` D27-D30 (append-only, so nothing
below was edited to hide what actually shipped first):

1. **D27 -- the answer is ANONYMOUS, not a named introduction**, reversing
   this report's own "two decisions the owner fixed" section below almost
   entirely on point 1. B never learns who answered. Read D27, not the
   named-introduction description a few paragraphs down.
2. **D28/D30 -- FAST is the shipped default**, not the uniform 30-second
   wait the "timing fork" section below was written around (that section
   already carries one correction, for the D25->D26 timing-wiring bug; it
   is now stale a SECOND time, on the default itself). Read D28 and D30 --
   D30 in particular, because D28 alone (one switch) was superseded within
   the same day by D30 (two independent switches, different defaults, and
   an honestly-stated residual the owner specifically asked not to be
   papered over).
3. **D29 -- a second-hop accommodation answer never carries the real
   address**, only an abstraction (city + free window). This did not exist
   in the first version of this report at all: demo 21 did not carry the
   accommodation query yet. See the "Scenario A merged" entry in
   `DECISIONS.md` for why it does now, and D29 for the redaction itself.
4. **Post-review hardening pass**, done before merge, not part of any owner
   correction: an `advisor()` review of the D27-D30 work found one real,
   fixable pre-show risk (a stale-localStorage migration gap on
   `secondBrainNotes`, now fixed in `state.ts`'s `withDefaults`), one
   overclaiming sentence in D30 (scoped correctly now), one test-fixture
   drift in `test/e2e/second_hop.mjs` from the production code it mirrors
   (fixed), and one encoding bug in leg 9's byte-level address check (latin1
   substring search on UTF-8 bytes -- fixed to a raw byte search). A fifth
   suspected issue (relayed content leaking back into A's own direct-match
   path) was investigated and traced to be NOT live in the current code --
   see `DECISIONS.md`'s "Post-review hardening" entry, point 5, for the
   full trace. Nothing here changes D27-D30's decisions themselves.

Everything else below -- the depth cap, the byte-masking mechanism, D24 (the
intermediary sees what she carries), the general architecture -- still
holds. Regression counts at the bottom of this report are the FINAL ones,
after all four corrections plus the hardening pass; earlier counts appear
only inside the correction call-outs themselves, for the historical record.

## What landed

Third `WotScenario` value, `'secondHop'` (`apps/demo/src/mode.ts`), built as
`VITE_WOT_MODE=relay VITE_WOT_SCENARIO=secondHop WOT_BASE=/wot/demo21/`.
Three-device chain: **Jakob** (the laptop, root of the chain, auto-seeded
exactly like demo 20's), **A** (invited by Jakob's own link, gets a private
second-brain note), **B** (invited by A's link, gets none). The story is the
one `verification/alpha-run.txt` leg (g) already ran live at the daemon
layer -- Alice/Bob/Carol and a ladder -- re-enacted here in `apps/demo`'s own
browser-facing protocol, on purpose: this demo is proving something already
shown to work, not inventing a new story.

Every incoming query in this scenario, except on Jakob's own device, routes
to a new, dedicated ceremony (`runSecondHopRelayCeremony`,
`renderSecondHopDirectCard`, `renderSecondHopRelayCard`, `forwardToOwner`,
`sendSecondHopFinalAnswer`) rather than reusing `runConsentCeremony` with
more branches threaded in -- deliberate, given how much of this project's
credibility rests on that one function's existing, tested discipline. Jakob's
own device keeps using `runConsentCeremony` completely unmodified, plus one
small, strictly-gated addition (the named-introduction card, below): I3 only
has to hold at the LAST hop, the one an asker who has never met the final
answerer is actually watching the clock on, so Jakob's side never needed the
fixed deadline the relaying hop does.

## The two decisions the owner fixed, and what they required in code

**D23, named introduction, not an anonymous answer.** `SharedPayload.from`
(previously always `""` -- `gate.ts`'s own documented "known gap") now
carries the true answerer's name, verbatim, threaded through by the relaying
hop rather than recomputed. `screenResult` renders it whenever it differs
from the peer B asked directly. Consenting to answer and consenting to be
named are bundled into one choice for Jakob (`runConsentCeremony`'s
`namedRelay` branch, gated on `wotScenario() === 'secondHop' && q.relayed
=== true`): three buttons -- decline, answer without naming, answer and
name -- where the middle option is a real, distinct local choice for I6's
sake but produces the byte-identical wire "nothing" of an outright decline.
**Position taken and stated plainly:** an introduction that named someone
against their own choice not to be named would not be a named introduction;
the only things that ever reach B are "named" or "nothing," never an
anonymous-but-real answer.

**Jakob learns it is a relay BEFORE he decides**, not after (the daemon's own
shipped order -- INTRO after CONSENT -- was flagged as a mistake worth not
repeating, not a precedent to follow). The same card that offers the
named/unnamed/decline choice also states, before any button, that this
question did not come directly from A, that it came from someone he does not
know, and that answering-and-naming means that person learns his name. It
deliberately does not name B: he does not need her identity to decide, only
that she is not A.

**D24, the intermediary sees what she carries.** Structural in this
transport, not merely permitted: A decrypts B's question under her own A<->B
pair key and, if she forwards it, re-encrypts under her own A<->Jakob pair
key -- there is no multi-party key `apps/demo` could have used instead
(`relay.ts`'s own header: pairwise keys only). The existing one-hop honesty
sentence (`relayExplain`) says the relay SERVER cannot read content and
stays true, unchanged, at two hops. It does not say the intermediary cannot,
so demo 21 needed and got its own sentence for that, in both required
placements (docs/two-hop-decisions.md §3):

- **B's ask screen, before she sends** (`secondHopAskHonesty`): "Deine Frage
  geht nicht direkt an Jakob. {A} bekommt sie zuerst zu lesen und
  entscheidet, ob sie sie weitergibt. Wenn sie das tut, sieht sie auch die
  Antwort. Der Server sieht in beiden Fällen nur unlesbaren Text; {A} nicht."
- **A's own screen, at the moment she is asked whether to forward**
  (`secondHopRelayHonesty`): the same claim, addressed to her directly.

**Unclosable, stated once rather than implied away:** nothing in the app
stops A from telling B, out of band, that Jakob answered or declined --
D23 only governs what the wire reveals and what Jakob consented to have
named. This is a strict superset of the trust every messaging app with a
human intermediary already carries; the fix, if the owner wants one, is
social, not technical, and no UI copy can close it.

## What B and A each learn (the full account, not just the headline)

**B (asker).** Before asking: that her question may travel through A to
someone she has never met, and that A can read both the question and the
answer if that happens (the honesty sentence above, unconditional -- she
cannot know in advance whether a relay will actually fire). While waiting:
nothing distinguishing -- a static "this takes up to 30 seconds either way"
note, not a live per-hop status. On success: the true answerer's name
(Jakob), introduced via the peer she actually asked (A), and the shared
content. On "nothing": exactly that, indistinguishable across five different
underlying causes (below).

**A (intermediary).** Sees B's question text to decide whether to relay at
all (D24). If she forwards: sees Jakob's real answer, in full, the moment it
arrives -- she is not blind to her own forward's outcome. Knows, necessarily,
that she relayed (she is the one who chose to), and her own local Protokoll
can record `relayed`/`relay-nothing` distinctly from an ordinary direct
answer (I6) -- deliberately coarser in one place: her `declined-to-relay`
button and her `no-note-at-all` ending both log as the matcher already
labels them (`declined` vs `no-match`), which is honest and accurate, not a
gap.

**Jakob (final answerer).** Learns, before deciding, that the question is
relayed and from someone he does not know (not from A herself) -- see D23
above. Never learns B's identity. His own hop to A is NOT held to the fixed
deadline (`GATE_BUDGET_MS`, the ordinary ~900ms machine-time equalisation,
unchanged) -- see "Why Jakob's own hop needs no new timing discipline" below
for why that is correct rather than an oversight.

## The timing fork (docs/two-hop-decisions.md §4), and what was chosen

**Correction (see DECISIONS.md D26): this section originally described a
mechanism that did not actually deliver what it claimed.** The first version
of this feature called `settleAt(receivedAt, RELAY_DEADLINE_MS)` from INSIDE
each ending, AFTER a human had already decided -- `settleAt` resolves
immediately once its target instant has already passed, so any ending
reached after a human deliberated longer than the window fired the moment
that human acted, not at the fixed deadline. This reopened the exact
hop-count oracle the deadline exists to close, and it was caught only by a
second review pass, not by the original test suite (no test had ever called
the timing path with an already-elapsed `t0`). The description below is the
CORRECTED mechanism, as shipped; D26 has the full account of the bug.

The design doc found that `apps/demo`'s answer model -- one synchronous round
trip B is watching happen, no representation for "still travelling to hop
2" -- forces a choice between inventing a new waiting state or holding B's
answer to the deadline of the existing round trip. **Chosen: the second.**

`gate.ts`'s `RELAY_DEADLINE_MS = 30_000` (this project's own already-stated
I3 default -- CLAUDE.md: "default 30 s, no jitter" -- reused, not invented)
is the ONE anchor every ending on A's hop is held to -- now via `main.ts`'s
`createRelayDispatch(q, peer, receivedAt)`, which arms a single `setTimeout`
at `receivedAt + RELAY_DEADLINE_MS` BEFORE any human interaction can happen
(the same shape `packages/agent-daemon`'s `scheduleAt`/`dispatchOwnerStatus`
already uses: content read at fire time, fire time fixed at receipt). Every
ending -- A's own direct match (`decide()`), a declined relay (`decide()`),
a completed or timed-out Jakob round trip (`dispatch.resolvePayload()`) --
only ever calls `dispatch.resolve()`/`resolvePayload()`, which UPDATES what
will be sent; it never sends anything itself. A resolve arriving after the
timer already fired is a documented no-op: the "nothing" already went out,
and the late decision is simply too late -- exactly like Jakob answering
after the deadline already was. This is deliberately NOT scoped to only the
relay-attempted paths -- A's own direct match (had this demo's seed given
her one) is held to the identical deadline, so "A answered directly" and "A
relayed and got nothing" cannot be told apart by the clock either.

**UI consequence, handled explicitly:** holding the send to a fixed point
regardless of tap time means a card left on screen after being tapped would
sit there, still clickable, for up to the remainder of the window.
`renderSecondHopPendingScreen()` replaces it the instant a decision is
recorded, saying only that the decision is noted and will be sent on the
same schedule as any other answer -- never what the outcome is or how far
the question travelled.

**Why Jakob's own hop needs no new timing discipline.** I3 (indistinguishable
no) is a promise to the ASKER -- the one party who cannot otherwise infer
anything. A is not that party on the A<->Jakob hop: D24 already makes her a
knowing, reading participant regardless of what Jakob's timing does, so
there is nothing left for a uniform delay on that hop to protect. Jakob's
own `emitAnswer` call therefore keeps the ordinary `GATE_BUDGET_MS` path,
completely unmodified.

**A's own visible behaviour as a channel, addressed directly (raised in the
coordinator's follow-up, not only in the design doc).** A's own SCREEN can
change the instant Jakob answers -- that is D24's whole point, she is a
knowing participant. What matters for B is only what crosses the WIRE to
her, and that is unaffected by anything A's screen does: the one and only
envelope A ever sends B fires at the fixed deadline regardless of when A
herself learned the outcome, and B's own transport channel is never given
A's or Jakob's key at all, so B has no way to observe A-Jakob traffic even
indirectly (proven in the live e2e test, below: B's drain is registered with
exactly one key, the A<->B pair key, for the entire run).

## Byte-level proof (point 4)

Two layers, deliberately not one:

**Pure-function** (`test/second_hop_gate.test.ts`): the exact primitives
`sendSecondHopFinalAnswer` calls (`maskAnswerPlaintext`, `truncateSharedJson`,
`sealAnswerEnvelope`, and the real `decide()` for the one case that goes
through it, A's own decline-to-relay) produce byte-identical ciphertext for
five structurally different "nothing" causes, at a fixed qid/key, and
byte-identical decrypted plaintext (the all-zero buffer) independently
confirmed. A genuine "shared" case produces different ciphertext and carries
the true answerer's name verbatim (no `coarseWhen` re-derivation -- see that
function's own doc comment for why recomputing it from a fabricated
timestamp was rejected as a factual-error risk, not just an inefficiency).

**Live, three real devices, real network** (`test/e2e/second_hop.mjs`,
`npx tsx test/e2e/second_hop.mjs` against `https://questhub.eco`): Jakob, A,
and B as three independent `did:peer:2` identities on three independent
relay drain connections. Legs 1-7: success; A declines to relay; Jakob
declines; Jakob has nothing; the I8 depth-cap guard (an already-`relayed:
true` query reaching A must never trigger a second forward, confirmed by
watching Jakob's channel receive NOTHING for that leg); a genuine unrelated
no-match; and one leg that pins a SINGLE qid across two different
nothing-causes to prove the strict ciphertext-byte-identity claim against
real bytes that crossed the live relay twice, not only the pure-function
proof. **Leg 8 (added post-D26)** reproduces the fixed `createRelayDispatch`
pattern directly against the live relay with a short local deadline: 8a
proves a resolve reached BEFORE the deadline still waits for it, rather than
firing early; 8b proves a resolve arriving AFTER the deadline already fired
is a no-op -- exactly one envelope reaches B, its content is "nothing," not
the late decision. This is the leg that would have caught D26's bug; it did
not exist in the branch that shipped the bug. **30/30 assertions pass.**
Full run:

```
second_hop: targeting https://questhub.eco
  PASS  all three drains authenticated (Jakob, A, B -- B never directly connects to Jakob at the transport layer either)
  PASS  leg 1 (success): B's decoded outcome is "shared"
  PASS  leg 1: the named answerer is Jakob, VERBATIM, carried by A, never Jakob himself sending to B
  PASS  leg 1: the ladder text reached B unchanged
  PASS  leg 2 (A declines to relay): NOTHING was ever sent to Jakob's channel
  PASS  leg 5 (I8 depth cap, relayed: true incoming): NOTHING was ever sent to Jakob's channel
  PASS  leg 7 (same qid, live relay both ways): "A declines" and "Jakob declines" are BYTE-IDENTICAL ciphertext
  PASS  leg 8a (fast resolve): send happened at-or-after the fixed deadline, not immediately
  PASS  leg 8a: content resolved before the deadline DOES reach B
  PASS  leg 8b: the shared timer already fired BEFORE the slow decision arrived
  PASS  leg 8b: exactly ONE envelope reached B for this qid -- no second message from the late resolve
  PASS  leg 8b: B's outcome is "nothing" -- the late "yes" never overrides what the deadline already sent
  PASS  leg 8b: sent at-or-just-after the fixed deadline, not when the late resolve ran
  PASS  leg2_a_declines / leg3_jakob_declines / leg4_jakob_no_match / leg5_depth_cap / leg6_genuine_no_match /
        leg8b_late_resolve_is_noop: each decrypts under the real A<->B pair key, interpret() reads "nothing",
        and the PLAINTEXT is byte-identical to every other one of the six
  PASS  leg 1 (success) plaintext is DIFFERENT from every nothing cause

Total wall time: ~13.2s. All assertions passed.
```

Timing proof, injected clock, no real 30-second wait (`test/second_hop_timing.test.ts`):
a near-instant decision and a near-full-window decision both resolve at the
identical wall-clock instant `t0 + RELAY_DEADLINE_MS`. This test proves
`settleAt` itself is correct in isolation -- it does NOT, and never did,
prove that `main.ts` calls it at the right moment; that was D26's gap, now
closed by e2e leg 8 above, which exercises the real wiring rather than the
primitive alone.

## Judgment calls the coordinator explicitly asked to be surfaced, not silently resolved

**k = 7.** Answered in full in `DECISIONS.md` D27. Short version: this app's
second-hop path today runs at the SAME `kThreshold: 1` demo crutch every
template in this app already ships at (documented in each template's own
comment as not the production floor). Raising the number alone would not
reach k=7 for this app's own inventory/note-based content specifically,
because a second-brain note or an inventory line is structurally
single-author (`distinctAuthors` capped at 1 by construction) -- getting
there needs a data-model change (some notion of independent corroboration by
several people), not a config change. Not attempted here; flagged instead.

**Whether the timing switch is in the right hands.** Answered in
`DECISIONS.md` D30: split into two switches once the owner pointed out the
mismatch. The person B directly asked (the answerer) and the person who
might reach beyond herself (the relayer) are the SAME device in this cast,
so there was never a wrong-PERSON problem -- but there was a wrong-GRAIN
one: one switch governing both roles conflated "how fast do I like
answering when nothing is at stake" with "should this specific act of
reaching out to someone else be timing-observable," which are different
questions with different correct defaults. Two switches, two defaults, D30
has the full reasoning and the honestly-stated residual (the two defaults'
own difference from each other is itself a coarse signal that cannot be
fully closed without giving up one of the two decisions the owner actually
wants).

**Anonymous + address = home address to a stranger.** My own view, for the
record, alongside the owner's actual resolution (D29): an anonymous SOURCE
and a PRECISE, individually-identifying piece of content are two different
axes of exposure, and collapsing them into "anonymity wasn't enough, so
un-anonymize" would have been the wrong fix -- it would have solved the
address problem by reopening the one the owner had just closed (D27). The
better fix is exactly the one taken: keep the source anonymous, and instead
narrow WHAT crosses a hop it was never scoped for, the same way this whole
protocol already narrows disclosure by consent and by hop rather than by
identity per se. Would a named introduction have been defensible instead,
specifically for this one template? Arguably yes, as a second, independent
lever -- but it does not need to be reached for here, because the payload
narrowing alone already removes the specific harm named (a home address
reaching someone who could physically use it), and adding a second lever on
top would be solving an already-solved problem at the cost of the general
anonymous default the owner had just set. I did not change the anonymous
default; D29's abstraction is the whole fix.

## Regression (FINAL -- after D27, D28, D29, D30, and the post-review hardening pass)

- `tsc --noEmit`: clean.
- `vitest run`: **311 passed** (was 309 after D26, 310 after D27-D30; +1 net
  from the hardening pass -- `test/state_secondbrain_migration.test.ts`,
  proving `withDefaults` migrates a pre-rename `secondBrainNote` (singular)
  into `secondBrainNotes` (array) for a device that ran an earlier build of
  this branch).
- `test/e2e/second_hop.mjs`: **41 assertions, 41 passed, 0 failed** against
  the live relay (`questhub.eco`), ~16-17s wall time -- counted directly
  from the run's own output (`grep -c PASS`/`grep -c FAIL`), not hand-
  tallied. This session's own earlier "40/40" figure (written before this
  hardening pass, same uncommitted draft) was an uncounted arithmetic slip,
  not a true prior count: the hardening pass's leg 9 fix (below) rewrote how
  ONE existing assertion is computed, it did not add or remove an `ok()`
  call, so the actual total was already 41 before this pass touched
  anything. One run hit a transient `waitFor` timeout on leg 3 (relay
  network noise, same class of flake documented earlier in this project's
  history, unrelated to any code changed here); the immediate retry passed
  all 41 cleanly.
- `vite build` succeeds for demo 1, demo 20, and demo 21 (both the
  address-free default build and the opt-in address-bearing one).
- **Address-leak check, done rather than assumed** (the coordinator's own
  past mistake, named explicitly: exporting `VITE_WOT_ADDRESS` for a whole
  deploy run once leaked it into demo 1/2/3/6): built demo 1, 2, 3, 6, and
  demo 21's address-free configuration locally with a clearly-fake test
  address (`TESTADDRESS_DO_NOT_USE_Wienzeile_999_1234_Wien`) NOT set, and
  demo 20 plus demo 21's opt-in configuration WITH it set, then grepped
  every resulting `dist/`. Zero matches in the first five; exactly one match
  each in the two opt-in builds. Confirms `scripts/deploy_wot.sh`'s new
  demo-21 gate (mirrors demo 20's own, reusing the same `DEPLOY_DEMO20`/
  `VITE_WOT_ADDRESS` env vars since it is the same secret) actually holds.
  Re-run a second time, independently, after the hardening pass's `state.ts`
  change, with a different throwaway test address string -- same result.

**Operational note for tonight's live run.** If any of the three phones
(Jakob, A, B) has already loaded an earlier build of this branch (a
rehearsal run), its local `secondBrainNotes` field specifically is now
migrated automatically on next load -- that one field alone does not need a
manual reset. This is narrower than "the phone is fine": a rehearsal phone
also carries peers, a relay identity, and a chat log from whatever it did
last, none of which this migration touches. Verified via `db.ts`'s `kvSet`
being a plain structured-clone store with no schema/key validation of its
own, so a stray legacy field surviving alongside the migrated one is
harmless (every reader uses the new field only) but is not itself evidence
that the rest of a phone's state is current. `resetAll` remains
available as a fallback if anything else about a phone's state looks stale.

## Regression (as it stood after D26, kept for the historical record)

- `tsc --noEmit`: clean, before AND after the D26 fix.
- `vitest run`: **309 passed**, unchanged by the D26 fix (was 300 before this
  branch; +9: 4 in `second_hop_gate.test.ts`, 2 in
  `second_hop_timing.test.ts`, 3 new `relayed`-field cases in
  `wire.test.ts`). No vitest file needed changing for D26 -- the bug was in
  `main.ts`'s wiring, not in any pure function these tests exercise; the new
  coverage for it lives in the e2e script instead (leg 8, above).
- `seven_steps.mjs` against a fresh demo-1 build (`WOT_BASE=/`, no scenario,
  no mode): **23/23**, unchanged.
- `vite build` succeeds for demo 1 (default), demo 20
  (`VITE_WOT_SCENARIO=geologengasse`), and demo 21
  (`VITE_WOT_SCENARIO=secondHop`) configurations, before and after D26 --
  identical bundle size after the fix (323.72 kB), confirming no dead weight
  from the removed `emitAnswer` `opts.deadline` override was left behind.
- Demo 20's own flow, checked two ways since no dedicated automated script
  exists for it (noted honestly, not papered over): (a) a Playwright pass
  against a real demo-20 build confirms `geoChainHonesty` still renders,
  word for word, and `secondHopChainHonesty` does not appear in that build,
  and vice versa for a demo-21 build -- the two scenarios' copy stays fully
  partitioned; (b) demo 20's underlying mechanics (relay transport,
  connect-link ceremony, `emitAnswer`/`decide()`, the `LocalOutcome` switch
  I extended) are the SAME shared code every other regression check above
  already exercises, so `seven_steps.mjs` and the live `second_hop.mjs` run
  are indirect but real coverage of exactly the functions this branch
  touched. Demo 20 does not route through `createRelayDispatch` at all (it
  is not the `secondHop` scenario), so D26's bug never applied to it and the
  fix touches none of its code paths.

**Two smaller findings from the same review pass, both fixed (DECISIONS.md
D26 has the full account):**
- `secondHopAskHonesty`/`secondHopChainHonesty` on `screenAsk()` were gated
  on the scenario flag alone, a build-time value shared by all three
  devices -- rendering a false claim on Jakob's own ask screen ("your
  question does not go straight to Jakob," shown to Jakob) and on A's ask
  screen when she asks Jakob directly (no relay involved in that call at
  all). Now gated on `isLeafAsker` (`s.me.id !== 'jakob' && !s.secondBrainNote`),
  true only for B.
- A device could have offered to relay a question back to its own
  requester (Jakob asking A something matching her note about Jakob would
  have rendered a relay offer to forward Jakob's own question back to
  Jakob). `runSecondHopRelayCeremony`'s owner-peer lookup now excludes
  `p.id === q.from.id`, the same sender-exclusion reasoning D14's own relay
  logic already applies elsewhere in this app.

## What could not be closed, stated plainly

**The "In die Runde fragen" -> "Ins Netzwerk rufen" rename.** Applied on
`main` (commit `bace7e3`, values AND comments/doc strings, across
`i18n.ts`/`main.ts`/`types.ts`/`wire.ts`/`data/free_text_query.ts`) while
this branch was already in flight. This branch still says the OLD wording
in every one of those files -- deliberately NOT touched here, on the
advisor's own guidance: editing the exact same lines main already renamed
would only create merge conflict, not progress, and this branch introduces
no NEW occurrences of the old phrase. Whoever merges/rebases this branch
onto `main` gets the rename for free from `main`'s own commit; nothing
further is needed from this branch's side. Flagged here so it is not
mistaken for an oversight.

**Browser-driven, cross-context confirmation that the CONNECT-LINK ceremony
completes over the LIVE relay** (Jakob's link opened in one Playwright
context, A's device in a second, confirmed paired) was attempted and did not
succeed from an ad-hoc local static file server: it has no `/relay/*` proxy
to questhub.eco (only the deployed `app.idea2.site` host has that, per
`scripts/deploy_wot.sh`'s own header comment), so the connect-ack's POST has
nowhere real to land locally. This is not a CORS finding specific to this
feature -- it is the same category of gap `DECISIONS.md` D22 already
disclosed for this app's architecture (every live-relay proof in this repo
runs Node scripts directly against the real modules, precisely because a
page not served from the relay's own deployed origin cannot exercise that
transport). What WAS verified in a real browser, DOM and all: Jakob's device
auto-seeds correctly, the connect screen renders both the unchanged
`relayExplain` and the new `secondHopChainHonesty` sentence, a connect link
is produced, and A's device opening that link renders the free-text
name-entry screen and submits without a JS error -- no crashes, correct
scenario isolation, correct copy. The protocol correctness itself (bytes,
consent, deadline, depth cap) is the Node e2e script's job, run against the
real deployed relay, and it passed in full. Recommend: before the live show,
deploy demo 21 for real (`scripts/deploy_wot.sh`, now includes it
unconditionally) and run the actual three-phone chain once, end to end, on
the deployed origin -- the one thing this report could not exercise from a
laptop's own filesystem.

**A's own local Protokoll granularity.** "A declines to relay" and "A has no
note at all" both log as their matcher-accurate labels (`declined` /
`no-match`); a genuinely relayed-but-Jakob-said-no-by-name-only case is not
given its own fourth local label distinct from Jakob's plain decline. Judged
not worth the added `LocalOutcome` surface for this pass -- flagged here so
it is a stated cut, not a silent one.

**RELAY_DEADLINE_MS's practical cost to the live demo.** 30 real seconds
means Jakob needs his phone unlocked and attentive before B asks, or the
window closes on a genuine "yes" too. This is the honest price of I3 holding
across two hops in a single-round-trip transport, not a bug -- but it is
worth saying to whoever presents this live, so the wait reads as the point,
not as the app being slow.
