# Handover — good enough to hand to a friend, and a way to tell the operator

Worktree: `git worktree add ../wt-report -b feat/report-to-admin`. Work in
`apps/demo/`. **Do not start until the chat and inventory streams have merged**
-- all three touch `main.ts` and a three-way conflict there is expensive.
Commit locally.

## The goal, in the owner's words

> i want to get it to the point where it's actually possible for this person to
> just be okay with sharing this with their friends, and then those friends can
> call into the web and they can offer resources, and they can even tell admin
> that they've shared resources and tell admin that they've had an issue

Two halves. The second is buildable and specified below. **The first is the
harder one and it is not a feature**: it is whether someone would be
comfortable putting this in front of their own friends. Judge every choice here
against that, and say in your report anything you found that would make a
person hesitate.

"Admin" is the person whose link they joined through. In demo 20 that is
Jakob's laptop.

## Build

**1. Two structured reports, from any connected peer to the person they joined
through.**

- **"Ich habe etwas geteilt"** -- they lent something, hosted someone, passed
  something on. Free text, short.
- **"Es gibt ein Problem"** -- something did not work, or something felt wrong.
  Free text, short.

Both travel as ordinary envelopes on the existing transport (extend the wire
the way `ChatEnvelope` was added: strict validation at the boundary in
`wire.ts`, a bounded text length, tests for malformed input). Do **not** invent
a new transport or a server-side inbox.

**2. On the operator's device, a list, not a chat.**

Reports land in a screen that shows who, when, which kind, and the text, newest
first. It must survive a reload -- unlike today's chat and pending requests,
which are in-memory only. Persist through the existing store, and remember
`storageIsEphemeral()`: on a phone that blocks storage this is a per-visit
list, and the UI should say so rather than promising durability it cannot give.

**3. Acknowledgement.** The person who sent a report should be able to see that
it arrived. A report that vanishes into silence is worse than no report button:
it teaches people the thing does not work.

## The judgement half

Walk the whole path as if you were the friend, not the developer, and write
down what you find:

- Open the link cold on a phone. Is it obvious what this is and who invited
  you, before you are asked for anything?
- Is it clear what stays on your device and what leaves it? The relay honesty
  strings exist; are they where a person would actually look?
- Can you tell the difference between "nobody had this" and "someone said no"?
  You should NOT be able to -- that is invariant I3 -- but check that the UI
  does not accidentally reveal it, for instance through timing or a log entry.
- Is there any dead end: a screen that changes nothing when you act, or an
  error that says nothing? Several of those have been found by the owner
  already, each in a live session, and each one cost trust.

Report every such finding even if you do not fix it. That list is worth more
than the feature.

## Constraints

- Consent gate, k-anonymity floor, byte-identical "no answer": untouched.
- Reports are not queries and must not go through the matcher.
- Demos 1, 2, 3, 6 keep working; `seven_steps.mjs` is the regression check.
- German first, plain register, no em dashes.
- `tsc --noEmit` and `vitest run` must pass.

## Report

`DEVLOG/result-report-report-to-admin.md`: what landed, an end-to-end test
against the live relay showing a report sent from a guest and read by the
operator after a reload, and the full list of hesitation-points from the
judgement half.
