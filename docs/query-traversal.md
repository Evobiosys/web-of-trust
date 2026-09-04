# Query traversal: how far a question travels, and what choices people want over it

> "query, how it might travel through the network to 2nd and 3rd connections,
> anonymously or otherwise, and what choices people want over this traversal
> of the network."
>
> - the founder

> "It might be more complex to start with, it's often best to limit the
> number of parameters when experimenting."
>
> - the founder

This document takes the first question seriously and stays inside the
discipline of the second. It answers what the code actually does today, what
"reaching hop 2 or hop 3" would concretely mean, what choices people want over
that, and proposes exactly one small next step, not a menu.

Evidence in this document comes from the repository's own code and from
`verification/alpha-run.txt`, a transcript of a live run against real HTTP
daemons (not a description of intended behaviour). That is primary evidence
and is cited directly by file and line rather than tiered [A/B/C], which this
document reserves for anything external. Every claim below is marked SHIPPED,
DESIGNED, or SPECULATIVE. Confidence is noted where it is below 0.9, and
flagged with a warning below 0.7.

## 1. What ships today, precisely

Two separate SHIPPED mechanisms answer "how far" differently, and a third
exists but is not wired up. None of them is a general search of the network.
Read this section fully before reading "traversal" as one thing.

**a) The public demo has no trust graph at all.** `apps/demo` (deployed at
`idea2.site/wot-demo`, the one covered by the Nachweis page,
`apps/demo/public/nachweis/index.html`) pairs exactly two devices by QR code
and exchanges query/answer through an opaque store-and-forward relay
(`apps/demo/src/relay.ts`) that only routes ciphertext and never decrypts it.
Its own file header states the scope directly: "exactly one pair key alive at
any moment." There is no second person to reach, by construction. SHIPPED,
confidence 0.95.

**b) The direct ask fans out to hop 1, and only hop 1.** In
`packages/agent-daemon`, `Daemon.sendAsk` (`daemon.ts:148-193`) builds the
list of recipients from `store.getTrustEdges()` filtered to unexpired edges
(`daemon.ts:161`) and sends one `REQUEST` envelope to each. That is the
asker's own directly-trusted peers, nothing further. SHIPPED, confidence 0.95.

**c) A query CAN reach a second hop, through exactly one narrow, named path,
and this is shipped and live-verified, not merely designed.** This corrects
an assumption in this document's own brief, which is worth stating plainly
rather than quietly fixing: it is not true that no shipped code sends a query
past hop 1. Here is what actually happens (`daemon.ts:359-427`,
`daemon.ts:557-585` `forwardRelay`, `DECISIONS.md` D13/D15/D16,
`docs/PROTOCOL.md` §7):

- A hop-1 peer (say Alice) holds a locally-created `Item` whose
  `provenance.kind === "second_brain"`: "I know Timo/Carol has this," never
  entered by Timo/Carol themselves.
- If an incoming `REQUEST` matches that item, and the noted owner (Carol)
  still has a live, unexpired trust edge with Alice specifically (D16's guard;
  if not, this folds back into an ordinary no-match, byte-identical PASS), a
  consent card of kind `relay` is created for Alice.
- Only after Alice's own consent does `forwardRelay` compose one fresh
  `REQUEST` (new `request_id`, same envelope type, no new protocol surface)
  addressed to Carol alone. Carol then independently consents or not.
- This was run live end to end, not just unit-tested: `verification/alpha-run.txt`
  leg (g), "Bob asks -> Alice relays note about Carol -> two-hop consent ->
  Bob connected to Carol," against real HTTP daemons.

So a query does reach hop 2, but only when a hop-1 person already privately
knows something matching about one specific named hop-2 person, and only
after two independent consents. It is not a fan-out, not a search, and the
asker has no say in whether it happens. SHIPPED at the protocol/daemon layer,
confidence 0.9.

One caveat worth stating precisely because it changes what "shipped" means in
practice: there is no in-app way for a human to create the note that triggers
this. `addNote` exists as a daemon method and a wired `POST /api/notes`
endpoint (`server.ts:466-490`), and the client SDK
(`apps/mobile-ui/src/api_client_live.js:467`) exposes it, but no screen in
`apps/mobile-ui` or `apps/device-ui` calls it (checked directly; only
`ProvenanceBadge.tsx` in `apps/device-ui` reads and displays provenance, it
does not write it). Today the note is created via a direct API call or the
test harness. So: shipped and live-verified at the protocol/daemon layer,
with no shipped human gesture that seeds it.

**d) Hop 3 does not exist, and its absence is a deliberate decision, not an
oversight.** `FUTURE.md:6` lists "Multi-hop beyond one relay" among the
temptations explicitly not built. This is a direct, quotable answer to the
founder's "3rd connections": not built, and named as deliberately deferred.
SHIPPED-as-absence, confidence 0.9.

**e) Separately, non-query traffic already goes multi-hop, and this should
not be confused with query traversal.** `LISTING` (an owner's published
offer or gathering, not a question) forwards through the trust graph up to a
declared `steps` count (`listings.ts`, default 2, range 1 to 3), decrementing
per hop, tier-gated, cycle-safe, excluding the sender and everyone already in
the path. This is a push, not a query: nobody asked for it, and no answer
comes back through it. Unit-tested for the forwarding logic and the cyclic
case (`listings.test.ts` "forwards within declared reach," "never forwards a
listing back to its own owner ... through a cyclic trust graph"). SHIPPED,
confidence 0.85. Live confirmation is thinner than for (c): D17's alpha-run
verification of listings (leg b) confirms tier-eligible delivery to direct
edges, not a live multi-persona forward chain. ⚠️ Confidence in the *live*
forward-chain behaviour specifically: 0.6, unit-proven but not observed
end to end with three or more real personas.

**f) A fourth surface exists and answers a related but different question,
and is explicitly not part of the daemon yet.** `packages/network-access`
(D19, D20) lets a requester ask ONE owner whether anyone in that owner's own
first-ring contacts matches, and returns a k-anonymized count (default k=3,
`anonymity.ts`) rather than forwarding the question itself. `DECISIONS.md`
D19 states outright: "no daemon coupling yet." It ships as its own demo
(`pnpm --filter @resource-web/network-access demo`), E2E-verified with a live
model run, but is not reachable from `apps/mobile-ui`, `apps/demo`, or the
main daemon. SHIPPED as a standalone package, confidence 0.9; NOT integrated,
confidence 0.9.

**Summary of section 1, stated plainly:** a direct ask reaches hop 1 always.
A query reaches hop 2 only when a hop-1 person's private prior knowledge
happens to match and both hops consent, and this exists and has been run
live. Hop 3 is explicitly not built. A separate, unmounted package answers an
aggregate question about an owner's own contacts without forwarding the
query at all. Everything past this paragraph is either analysis of what
already exists, or design space, and the reader should not confuse the two.

## 2. What the traversal question itself means, grounded in what exists

The founder's five sub-questions can be answered concretely against the one
shipped hop-2 path (1c above), rather than in the abstract.

**Who learns that a question was asked.** At hop 1, always the queried
person (I4: "owner sees asker identity + request text," deliberate
asymmetry). At hop 2, the noted person (Carol) learns a question was asked
only if the hop-1 person's item matches and that hop-1 person consents to
relay. `verification/alpha-run.txt`: "PRE-CONSENT: Carol's DID absent from
ALL of Bob's state" and, once relayed, "Carol direct consent card exists
(requester=Alice)." SHIPPED, confidence 0.9.

**Who learns who asked.** This is not symmetric between the two hops, and
that asymmetry is the sharpest fact in this document. Carol never learns Bob
exists before consenting, and her consent card names Alice as the requester,
never Bob (`verification/alpha-run.txt`: "I8: Carol's card requester is
Alice, never Bob"). Bob, the original asker, learns nothing pre-consent (I2).
But on a *successful* relay, Bob learns everything: the 3-party room names
Carol, and its context card literally reads "... — introduced by
${Alice's name}" (`daemon.ts:614`). So identity attenuates going deeper
(hop 2 never sees hop 0), but resolves fully going back up, only on success.
SHIPPED, confidence 0.9.

**Whether an intermediary can tell an answer from a relay-through.** From
Bob's side, no: Alice's `PENDING`/`PASS` to Bob is dispatched by the same
`dispatchOwnerStatus` chokepoint regardless of whether her card is a direct
match or a relay (I3's uniform schedule applies identically). Bob cannot
distinguish "Alice found it herself" from "Alice is relaying to someone else"
until a room actually opens. SHIPPED, confidence 0.85.

**What an answer coming back reveals about the path.** On decline, nothing:
D15 made this an explicit fix specifically because forwarding Carol's PASS
upstream would have let Bob infer that relaying happened at all, violating
I8 ("no hop reveals more than a direct request"); the ask now just degrades
on its own TTL, silently, identically to a direct decline. On success, the
opposite: the full path is revealed (see above). This means I8's promise
holds exactly on "no," and visibly does not (by necessity, not by bug) on
"yes." SHIPPED, confidence 0.9.

**How the anonymity floor behaves when matches are spread across hops.**
It does not, today, because no cross-hop floor exists in the shipped relay
path at all. `queried_count` on an `AskRecord` counts only the asker's own
direct edges (`daemon.ts:162-171`); the one package with a real k-anonymity
floor, `network-access` (k=3 default), counts an owner's own first-ring
contacts and is not mounted to the daemon that runs the relay. There is
nothing today that would answer "how many people two hops out matched" even
approximately. This is a genuine open question, carried into §5 rather than
answered here.

**Does the design leak something across hops that it would not leak at one
hop?** One concrete answer, not speculative: on a successful relay, Bob
learns something a direct one-hop match never reveals: that Alice privately
held knowledge about Carol at all. A direct match only ever tells Bob "Alice
has this"; a relay additionally tells Bob "Alice knew something about a
third person, and it was relevant to Bob's question." That is new
information about Alice's private second-brain graph, surfaced by the very
fact of a successful two-hop introduction, and it is intrinsic to how a
3-party room necessarily works (everyone in a room must be able to see who
else is in it), not a bug to fix.

## 3. The choices people want over it

This is what the founder actually asked about, so it gets the most room.
Framed as choices a person makes, each with the honest default and why.
`DECISIONS.md` D1.5, D1.6, D16, D19-D21 and invariants I2, I3, I8, I9 already
settle several of these; they are cited, not re-decided.

**"How far may my question travel?"** Today this is not a choice at all.
It is entirely determined by whether a hop-1 person happens to hold a
matching note, not by the asker's preference. The honest default, if this
ever becomes an explicit choice, is 1 hop: I9's conservative-defaults
invariant and the fact that "multi-hop beyond one relay" is a named,
deliberately-deferred temptation (`FUTURE.md:6`) both point the same way.
Widening reach should be something a person turns on, never something that
happens because someone else's private notes made it possible.

**"May my contacts be asked on my behalf without being told who is asking?"**
Already yes, structurally, for the one relay path that exists, but this is
not something the note-holder chooses per ask, it is a protocol invariant
(I8) that always holds this way whenever a relay fires. Carol is always
asked "on Bob's behalf" without being told Bob exists. D1.6 gives Carol the
one lever she does have: she may attach `conditions` to her consent
(`CONSENT.body.conditions`), the same field any direct consent uses. Whether
this identity-withholding is reassuring or itself a concern the founder
wants to reconsider is exactly the kind of question this document should
surface rather than resolve; see §5.

**"May I be asked on someone's behalf, and how often?"** Split into two
already-settled parts and one open one. Settled (D1.6): you are never
notified that a note about you exists (deliberate, framed as parity with
ordinary human memory, not a gap to close). Settled: when a note does match
an incoming request, you get the same consent gate anyone does, including
the ability to attach conditions. Open, and not found anywhere in the code:
any limit on how many different people may hold a note about you, or how
often a matching request can trigger a relay to you. ⚠️ Confidence 0.6 that
this is a true absence rather than a control this review missed: grep found
no rate limiter on the relay path, but absence of evidence is weaker than a
direct disconfirming test.

**"Do I find out that a question passed through me?"** Answered differently
for each of the three roles, and each answer is already a real design
decision, not a gap:
- The relaying hop (Alice) always knows, necessarily: she is the one
  granting the consent that makes it happen, and it is audit-logged locally
  (I6, `relay_forwarded`, `relay_room_created`).
- The final answerer (Carol) always knows, the moment her consent card
  appears.
- The original asker (Bob) finds out only if the relay succeeds (§2 above,
  D15), never on decline, by design, to preserve I3's Indistinguishable No
  one hop further out.

**"Can I be asked about a person rather than a thing?"** Not really, today,
in the shipped daemon: matching is against `Item`s (resources), and a
second-brain note is still "I know X has this thing," not "X is available"
or any other person-level claim. The one place that comes closer is
`network-access` (§1f), which matches against a roster of the owner's own
`Contact`s and can, at Gate 2, reveal an identified contact by explicit
owner action (`reveal_identified`), but it is a separate, unmounted
package, and its own decision log flags the exact tension this choice would
raise before it can be merged: `docs/20-data-contract.md`'s retired `WEB-3`
/ ADR-3 rule forbids countable aggregate residue about non-consenting
second-ring people, and `network-access`'s k=3 floor is explicitly a
different object from that rule today (`anonymity.ts`'s own comment: "flagged
for contract review before this package is mounted into the daemon wire
protocol"). If "ask about a person" ever ships in the main product, that
review is a precondition, not an afterthought: this document is not the
place to resolve it, only to name that it is already on record as needing
resolution.

## 4. The smallest experiment that would teach something

Resisting a menu: one step, fewest moving parts.

**Proposal: make the hop-2 relay an explicit choice the asker makes on the
ask itself, default off, and measure exactly one number: how often people
turn it on.**

Concretely: the mechanism in §1c already exists, is already consent-gated at
both hops, and is already live-verified. What it lacks is any input from the
asker at all; today it fires or doesn't purely based on what a hop-1 person
happens to privately know. The smallest change is not building a new hop; it
is adding one asker-facing toggle on the ask, phrased as a choice ("may my
question travel one step further, through someone I trust, if they know
someone who might have this?"), defaulted off per I9, and gating the
already-built `forwardRelay` call on it.

**What this would settle:** whether people actually want their question to
go further when explicitly asked, as opposed to the current behaviour where
it happens silently and is entirely out of the asker's hands. That is a real
preference signal the team does not have today, and it is the cheapest
possible way to get it.

**What this deliberately leaves untested, stated explicitly so it is not
mistaken for a smaller version of a bigger plan:** hop 3 (still not built,
still not proposed here); any cross-hop anonymity aggregate (§2's open
question stays open); any change to what hop-2 learns or to the k-anonymity
floor; general friend-of-a-friend search (the relay stays a single named
recipient, never a fan-out); and whether hop-1 or hop-2 people change their
own willingness to participate once the asker's intent becomes explicit to
the system, which a simple toggle-rate count does not measure and a
follow-on step would have to.

No variant B is offered.

## 5. What we do not know

- **The anonymity floor across hops is undefined, not merely undesigned.**
  No shipped code answers "how many people two hops out matched" even
  approximately; the one k-anonymity floor that exists (`network-access`,
  k=3) counts a different population and is not mounted to the daemon. If
  reach is ever widened past the current single named hop, this gap has to
  be closed before it is, not after.
- **No rate limit was found on how often a given noted person can be
  relay-triggered**, nor on how many people may hold a note about the same
  person. ⚠️ Confidence 0.6 this is a true absence rather than a control
  missed in review.
- **The LISTING forwarding chain (§1e) is unit-proven but not confirmed
  live** across three or more real personas; D17's alpha verification covers
  direct tier-eligible delivery, not the forward hop itself in a live run.
- **Whether "ask about a person" (network-access) is meant to merge into the
  main product is an open, named decision**, not something this document
  should resolve: `network-access`'s own code flags the ADR-3 / retired-WEB-3
  conflict as needing contract review before it is mounted.
- **Whether the identity-withholding in §3's second choice ("may my contacts
  be asked on my behalf without being told who is asking") is the posture
  the founder actually wants, or one worth reconsidering now that it is
  named explicitly, is genuinely open** (this document surfaces it as a
  real property of the shipped design, not as a settled answer).
- **This document's own starting brief assumed no shipped code reaches hop 2.**
  That assumption was wrong (§1c) and has been corrected here rather than
  carried forward silently. It is flagged because a reader who asked this
  precise a question should be told when an earlier framing of the same
  question, even one used to scope this very document, did not hold up
  against the code.

**Continued in `docs/two-hop-decisions.md`:** what the owner's "named
introduction" and "the intermediary reads what she carries" decisions imply
for the hop-2 relay described in §1c, including whether the Indistinguishable
No survives a second hop.
