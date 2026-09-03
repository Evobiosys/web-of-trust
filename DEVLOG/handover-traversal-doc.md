# Handover — the document about query traversal

Repo: `Code/primary-repo`. Write to `docs/` on the current branch. Commit
locally. This is a WRITING task; change no code.

## Why

The founder of the organisation this is being shown to said the interesting
question is:

> query, how it might travel through the network to 2nd and 3rd connections,
> anonymously or otherwise, and what choices people want over this traversal of
> the network.

and, separately, a caution that shapes how we answer it:

> It might be more complex to start with, it's often best to limit the number of
> parameters when experimenting.

Both belong at the top of the document, quoted and attributed as "the founder",
because the second one is the reason the document does not sprawl. The
deliverable is a document that takes the first question seriously and answers it
within the discipline of the second.

## What it has to cover

**1. What actually happens today, precisely.** One hop. A query goes from asker
to a directly connected peer, matches locally, and comes back. Second and third
connections do not receive queries in any shipped demo. Say that plainly first;
everything after it is design space, and the reader must never be confused about
which is which. Ground it in the code: `packages/agent-daemon` (the relay/
second-brain paths), `packages/transport/src/relay_channel.ts` and
`ladder_channel.ts`, `packages/network-access` (the consent ladder and the
k-anonymity floor), and `apps/demo` (the shipped one-hop demo). Read them.

**2. The traversal question itself.** What a query reaching hop 2 and hop 3
would mean. At minimum: who learns that a question was asked; who learns who
asked it; whether an intermediary can tell an answer from a relay-through;
what an answer coming back reveals about the path; and how the anonymity floor
behaves when matches are spread across hops rather than concentrated at one.

**3. The choices people want over it** — this is the part the founder actually
asked about, so give it the most room. Frame them as choices a person makes,
not as configuration: how far may my question travel; may my contacts be asked
on my behalf without being told who is asking; may I be asked on someone's
behalf and how often; do I find out that a question passed through me; can I
be asked about a person rather than a thing. For each, say what the honest
default is and why. `docs/DECISIONS.md` D1.5, D1.6, D16 and D19 to D21 already
settle several of these; cite them rather than re-deciding. Invariants I2, I3,
I8, I9 in `CLAUDE.md` are the constraints any answer must respect.

**4. The smallest experiment that would actually teach us something.** This is
where the second quote earns its place. Propose ONE next step with the fewest
moving parts — one extra hop, one new choice exposed, one thing measured — and
say explicitly what it would settle and what it deliberately leaves untested.
Resist proposing a matrix of options; that is precisely what the founder warned
against.

**5. What we do not know.** Honest open questions, including any place where
the current design would leak something across hops that it does not leak at
one hop.

## How to write it

- Tier every external source [A/B/C] and give publisher plus date, per this
  project's citation convention. Prefer the repo's own docs and code as
  primary evidence over anything external.
- Mark confidence on any claim you are not certain of; flag anything below 0.7.
- Distinguish, in every section, SHIPPED from DESIGNED from SPECULATIVE. Use
  those words. The project's credibility with this audience rests on never
  blurring them; see `docs/PRIVACY.md` and the Nachweis page for the tone that
  has worked.
- No em dashes in prose.
- Length: as long as the material needs and no longer. A tight document that
  answers the question beats a survey.

File: `docs/query-traversal.md`. Add a one-line pointer to it from
`docs/00-overview.md`.

## Report

`DEVLOG/result-report-traversal-doc.md`: an outline of what you wrote, which
code you actually read to ground section 1, and every open question you had to
leave open.
