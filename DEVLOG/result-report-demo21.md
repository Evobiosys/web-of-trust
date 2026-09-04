# Result report -- demo 21 (a question that travels two hops)

Worktree: `../wt-demo21`, branch `feat/demo21`. Committed locally, not
pushed. Demos 1, 2, 3, 6 and 20 are untouched -- every change in this branch
is either additive (new files, new optional fields, new i18n keys) or gated
strictly behind `wotScenario() === 'secondHop'` and, for one small addition
to the shared consent card, `q.relayed === true` on top of that -- a
condition that is never true for any build before this one.

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

The design doc found that `apps/demo`'s answer model -- one synchronous round
trip B is watching happen, no representation for "still travelling to hop
2" -- forces a choice between inventing a new waiting state or holding B's
answer to the deadline of the existing round trip. **Chosen: the second.**

`gate.ts`'s new `RELAY_DEADLINE_MS = 30_000` (this project's own already-
stated I3 default -- CLAUDE.md: "default 30 s, no jitter" -- reused, not
invented) is the ONE anchor every ending on A's hop is held to:
`emitAnswer`'s new optional `opts.deadline` override, and
`sendSecondHopFinalAnswer`'s own `settleAt`, both compute their content AT
FIRE TIME, never earlier, from whatever is known at that instant. This is
deliberately NOT scoped to only the relay-attempted paths -- A's own direct
match (had this demo's seed given her one) is held to the identical
deadline, so "A answered directly" and "A relayed and got nothing" cannot be
told apart by the clock either. A late answer from Jakob, arriving after the
deadline, gets no second message to B (D15's own discipline, followed
exactly): recorded locally, dropped, full stop.

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
relay drain connections. Seven legs -- success; A declines to relay; Jakob
declines; Jakob has nothing; the I8 depth-cap guard (an already-`relayed:
true` query reaching A must never trigger a second forward, confirmed by
watching Jakob's channel receive NOTHING for that leg); a genuine unrelated
no-match; and one leg that pins a SINGLE qid across two different
nothing-causes to prove the strict ciphertext-byte-identity claim against
real bytes that crossed the live relay twice, not only the pure-function
proof. **21/21 assertions pass.** Full run:

```
second_hop: targeting https://questhub.eco
  PASS  all three drains authenticated (Jakob, A, B -- B never directly connects to Jakob at the transport layer either)
  PASS  leg 1 (success): B's decoded outcome is "shared"
  PASS  leg 1: the named answerer is Jakob, VERBATIM, carried by A, never Jakob himself sending to B
  PASS  leg 1: the ladder text reached B unchanged
  PASS  leg 2 (A declines to relay): NOTHING was ever sent to Jakob's channel
  PASS  leg 5 (I8 depth cap, relayed: true incoming): NOTHING was ever sent to Jakob's channel
  PASS  leg 7 (same qid, live relay both ways): "A declines" and "Jakob declines" are BYTE-IDENTICAL ciphertext
  PASS  leg2_a_declines / leg3_jakob_declines / leg4_jakob_no_match / leg5_depth_cap / leg6_genuine_no_match:
        each decrypts under the real A<->B pair key, interpret() reads "nothing", and the PLAINTEXT is
        byte-identical to every other one of the five
  PASS  leg 1 (success) plaintext is DIFFERENT from every nothing cause

Total wall time: ~8.8s. All assertions passed.
```

Timing proof, injected clock, no real 30-second wait (`test/second_hop_timing.test.ts`):
a near-instant decision and a near-full-window decision both resolve at the
identical wall-clock instant `t0 + RELAY_DEADLINE_MS`.

## Regression

- `tsc --noEmit`: clean.
- `vitest run`: **309 passed** (was 300 before this branch; +9: 4 in
  `second_hop_gate.test.ts`, 2 in `second_hop_timing.test.ts`, 3 new
  `relayed`-field cases in `wire.test.ts`).
- `seven_steps.mjs` against a fresh demo-1 build (`WOT_BASE=/`, no scenario,
  no mode): **23/23**, unchanged.
- `vite build` succeeds for demo 1 (default), demo 20
  (`VITE_WOT_SCENARIO=geologengasse`), and demo 21
  (`VITE_WOT_SCENARIO=secondHop`) configurations.
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
  touched.

## What could not be closed, stated plainly

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
