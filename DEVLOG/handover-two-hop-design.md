# Handover — write the decision behind the second hop

Repo: `Code/primary-repo`. This is a WRITING and REASONING task. Change no
code. Write to `docs/`, commit locally on the current branch.

Another agent is building demo 21 (the two-hop query) right now. This document
is the thinking that build should be able to point at, and the place where the
consequences are stated honestly rather than implied by an implementation.

## The two decisions the owner has made

He was asked two questions and answered "yes to both", which reads as:

1. **A named introduction, not an anonymous answer.** When B's question is
   answered by Jakob, whom B has never met, B learns it was Jakob, and Jakob
   consents to being named.
2. **The intermediary sees what she carries.** A, who passes B's question on to
   Jakob, can read the question and the answer. She is a knowing participant,
   not a blind pipe.

Treat these as decided. Your job is to work out what they IMPLY, write it down,
and flag anything that follows from them that the owner may not have intended.
If you find that one of them cannot hold without breaking an existing
invariant, say so plainly at the top: that is the most valuable thing you could
return.

## What the document must contain

**1. The decisions, stated precisely,** in the form the rest of the project
uses. `docs/DECISIONS.md` is append-only and numbered; follow its house style
and propose the next numbers. Cite the existing decisions these build on:
D1.5, D1.6, D13, D15, D16 all touch relaying and hop consent, and I8 in
`CLAUDE.md` is the provenance-and-hop-consent invariant.

**2. What each of the three people learns, exhaustively.** A table. For B, A
and Jakob: what they know before, what they learn from the question, what they
learn from the answer, and what they can infer that they were not told. That
last column is the one that matters.

**3. The consequence of decision 2 that must not be glossed.** If A can read
the content, then a two-hop message is NOT end to end between B and Jakob in
the sense the one-hop demo claims. The app currently tells people the relay
carries ciphertext it cannot read. That claim stays true of the SERVER and
becomes false of the INTERMEDIARY. Write the honest sentence that has to appear
in demo 21's UI, in German and English, and say exactly where it belongs.

**4. Whether the indistinguishable no survives.** There are now four reasons
B can get nothing: A had no one to forward to, A declined to forward, Jakob
declined to answer, Jakob had nothing. Work through whether B can distinguish
them, including by timing, and including what A's visible behaviour leaks.
If the design makes any of them distinguishable, say which and what it would
cost to close.

**5. What a named introduction costs.** B learns Jakob exists and that A knows
him. Is that reciprocal? Does Jakob learn who B is before deciding, and should
he? What happens if Jakob declines to be named: does B get an anonymous answer
or nothing? Take a position.

**6. The smallest thing that would test whether people actually want this.**
The founder's own caution applies: "it's often best to limit the number of
parameters when experimenting." One measurable thing, not a menu.

## How to write it

- Mark every claim SHIPPED, DESIGNED or SPECULATIVE, as `docs/query-traversal.md`
  does. Read that document first; this one continues it and must not contradict
  it.
- Ground statements in code you have actually read, cited by file.
- No em dashes. Confidence noted where below 0.9.
- File: `docs/two-hop-decisions.md`, plus a one-line pointer from
  `docs/query-traversal.md` and the proposed entries for `docs/DECISIONS.md`
  quoted in your report (do not append to DECISIONS.md yourself; that file is
  the owner's).

## Report

`DEVLOG/result-report-two-hop-design.md`: the position you took on each open
sub-question, anything that follows from the owner's two decisions that he may
not have intended, and any invariant you found under strain.
