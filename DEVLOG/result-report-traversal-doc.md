# Result: the query traversal document

Executed 2026-09-03. Writing only, no code changed. Branch: `demo-2026-08-31`
(the repo's current branch; the handover said "the current branch," it is not
`main`).

## What was written

`docs/query-traversal.md` (321 lines). Structure:

1. **What ships today, precisely**: six lettered findings: (a) `apps/demo`
   has no trust graph at all, one pair only; (b) direct fan-out (`sendAsk`)
   reaches hop 1 only; (c) a query CAN reach hop 2, but only through one
   narrow named path (the second-brain relay), shipped and live-verified,
   with the caveat that no shipped UI creates the note that triggers it;
   (d) hop 3 does not exist and is a named, deliberate omission
   (`FUTURE.md:6`); (e) LISTING forwarding already goes multi-hop today, but
   it is a push, not a query, and its multi-persona forward chain is
   unit-proven, not live-confirmed; (f) `network-access` is a separate,
   unmounted package answering a related but different question (an
   aggregate over the owner's own contacts).
2. **What the traversal question means**: the founder's five sub-questions
   (who learns a question was asked, who learns who asked, can an
   intermediary tell a relay from a direct match, what a returned answer
   reveals, how the anonymity floor behaves across hops), each answered
   against the one shipped hop-2 mechanism rather than in the abstract, plus
   one additional finding: a successful relay reveals to the asker that the
   middle hop privately held knowledge about a third person, something a
   direct one-hop match never would.
3. **The choices people want**: the five choices named in the handover,
   each framed as a first-person question, with the current (mostly
   already-decided) default and the decision citation, and one place
   (identity-withholding toward the relayed-to person) flagged as a genuine
   open value question rather than resolved here.
4. **The smallest experiment**: one proposal only: expose the already-built
   hop-2 relay as an explicit asker-facing toggle, default off, and measure
   one number (how often it is turned on). States explicitly what it does
   not test (hop 3, cross-hop aggregates, k-floor changes, general FoaF
   search, second-order participation effects). No alternative offered.
5. **What we do not know**: five open items, including the two the review
   could not close by reading code alone (any rate limit on relay frequency;
   whether the LISTING forward chain has run live with 3+ personas), the
   named-but-unresolved ADR-3/network-access tension, and an explicit note
   that this document corrects its own starting brief rather than silently
   diverging from it.

Also added a one-line pointer from `docs/00-overview.md` §7 (Reading order)
to `docs/query-traversal.md`. Note: `docs/00-overview.md` is itself part of
the older "Ecstatic World" UX-mockup doc series (00 through 70), not the
shipped-protocol docs (`PROTOCOL.md`, `DAEMON.md`, `DECISIONS.md`); the
pointer sits in that design-track doc because that is what the handover
specified, not because the traversal document is itself mockup material.

No em dashes appear in original prose. The one exception is a verbatim
quotation of a source-code string literal (`daemon.ts:614`, which itself
contains an em dash inside a template literal); quoting it exactly rather
than silently editing it seemed more honest than paraphrasing a direct code
citation.

## Code actually read to ground section 1

- `packages/agent-daemon/src/daemon/daemon.ts` (full file): `sendAsk`,
  `ownerHandleRequest`, `forwardRelay`, `relayHandleConsent`,
  `relayHandleStatus`, `dispatchOwnerStatus`, `finalizeConsent`.
- `packages/agent-daemon/src/daemon/listings.ts` (steps/via/forwarding
  logic, grepped in full, key sections read) and `listings.test.ts` (test
  names, to confirm what is actually asserted, not just what the code
  looks like it does).
- `packages/agent-daemon/src/api/server.ts` (the `/api/notes` route) and
  `apps/mobile-ui/src/api_client_live.js` / `api_client.js` (to check
  whether any screen actually calls `addNote`: none does).
- `apps/device-ui/src/components/ProvenanceBadge.tsx` and a scan of
  `apps/device-ui/src/components/` (to confirm provenance display only, no
  note-composer).
- `apps/demo/src/relay.ts` (full file, including its own header): this is
  the transport-layer store-and-forward relay used by the public demo, not
  the semantic second-brain relay; conflating the two would have been the
  exact error `PRIVACY.md` warns against.
- `packages/transport/src/relay_channel.ts` and `ladder_channel.ts` (file
  headers and key sections): confirmed these are delivery-ladder rungs
  (message transport), unrelated to query semantics, so the handover's own
  naming of these two files as evidence for "one hop" needed a caveat: they
  are evidence that *delivery* is opaque/metadata-only, not evidence about
  how far a *query* travels semantically.
- `packages/network-access/src/gates.ts` and `anonymity.ts` (full files):
  confirmed the k=3 floor, the `auto_reveal_identity` full-trust path, and
  that this package answers a different question (an aggregate over the
  owner's own contacts) than the second-brain relay does.
- `DECISIONS.md` (root, not `docs/`): read D1 (all six numbered items,
  since D1.5/D1.6 are items 5 and 6 of that list, not their own headed
  sections), D13, D14, D15, D16, D17, D19, D20, D21 in full.
- `PRIVACY.md` (root) in full: this is what supplied the explicit warning
  not to conflate the transport-layer delivery relay with the
  application-layer second-brain relay.
- `docs/PROTOCOL.md` §7 ("Relay / second-hop consent (I8), by composition")
  and its invariant table: confirms the code-level finding independently
  from a second source in the repo.
- `verification/alpha-run.txt` (the relevant sections): the live-run
  transcript that upgraded the second-brain relay from "unit-tested" to
  "live-verified," and specifically the exact lines proving Carol's card
  names Alice (never Bob) as requester.
- `FUTURE.md` in full: the source of the "multi-hop beyond one relay"
  deferred-temptation line that answers the founder's "3rd connections"
  question directly.
- `docs/research/solo-graph-extension.md` (partial) and `docs/20-data-contract.md`
  (in full): the latter turned out to be the older Ecstatic-World UX-mockup
  data contract, not the shipped protocol; used only where it supplied a
  genuinely relevant, clearly-labeled design-track fact (the ADR-3 /
  retired-WEB-3 rule against countable second-ring residue, which
  `network-access`'s own code explicitly cites as a live open tension).
- `docs/00-overview.md` in full, to place the pointer and confirm it is the
  mockup-series entry doc rather than the protocol-series entry doc.

## Course correction, stated explicitly (not buried)

The handover's own brief for section 1 said: "Second and third connections
do not receive queries in any shipped demo." That is not accurate for hop 2.
`packages/agent-daemon`'s second-brain relay does send a fresh `REQUEST` to
a named hop-2 person, gated by two independent consents, and this was run
live end to end (`verification/alpha-run.txt` leg (g)), not merely
unit-tested. I corrected this in the document itself (§1c) rather than
writing the handover's original framing and letting it stand, and flagged
the correction again in §5 so a reader who only skims the end still sees
that the document's own starting assumption did not survive contact with
the code. Hop 3 is correctly described as absent; that part of the original
framing held up.

## Every open question left open

All in `docs/query-traversal.md` §5, not duplicated here in full, but named
briefly: (1) no cross-hop anonymity floor exists anywhere in the shipped
relay path; (2) no rate limit was found on how often a given person can be
relay-targeted, or how many people may hold a note about the same person,
⚠️ confidence 0.6 this is a true absence rather than a review gap; (3) the
LISTING multi-hop forward chain is unit-proven but not confirmed with a live
3+ persona run; (4) whether `network-access`'s "ask about a person" pattern
is meant to merge into the main daemon is an explicitly named, still-open
decision, with a real contract conflict (ADR-3 / retired-WEB-3) already
flagged in that package's own code, not invented for this document; (5)
whether the identity-withholding the relay already implements toward the
noted person is the posture the founder wants, or one worth reconsidering
now that it has been named plainly, is left as a genuine open value
question rather than resolved.

## Not done / explicitly out of scope

No code was changed, per the handover. No experiment was implemented, only
proposed in prose (§4). No attempt was made to resolve the
`network-access`/ADR-3 tension or the missing cross-hop anonymity floor;
both are named as open, per the task's own instruction to end with one small
experiment rather than a menu of fixes.
