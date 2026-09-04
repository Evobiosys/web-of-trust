# Handover — three modes at onboarding, so nobody lands in an awkward situation

Worktree: `git worktree add ../wt-modes -b feat/three-modes`. Work in
`apps/demo/`. Commit locally; pushing this repo is fine.

## The owner's feedback, verbatim

> one feedback is important: not to get people into unangenehme situationen.
> so make sure that in the onboarding there is 3 settings:
> pro - i know what i am doing and will nuance what i share and talk
> safe
> default - which is also quite safe

Three modes, chosen during onboarding, on every device including the guests
who arrive by connect link.

**Read the risk he is naming correctly.** It is not only data leakage. It is
SOCIAL awkwardness: being asked something you would rather not have been asked,
having to say no to someone you know, or having a no read as a no *to them*.
A person who ends up in that position once will not use this again, and will
tell others. Design the modes around that, not around a checklist of toggles.

## What the modes must actually control

These already exist as separate mechanisms; the modes bundle them into three
coherent postures. Find each one in the code before wiring it, and list in your
report what you found and what you chose to include:

- free-text asks versus the five fixed templates (`data/free_text_query.ts`,
  `data/templates.ts`). Free text sends the asker's own words verbatim to every
  connected device. Fixed templates send an identifier. That difference is the
  single biggest lever on awkwardness.
- whether inventory and chat threads are in scope by default
  (`threadsInScope()` in `state.ts`, the `included` flag).
- the answerer's reach-reveal switch and the relayer's reveal switch
  (D28/D30, `secondHopUniformModeDirect`, `secondHopRevealRelay`).
- whether questions may travel a second hop at all.
- the k threshold (`kThreshold` in `data/templates.ts`), noting the finding in
  DECISIONS.md D27 that a structural one-author cap means raising it does not
  by itself deliver real k=7.

## The three postures

Name them in German first. Sensible starting point, adjust with reasons:

- **Sicher.** The most protective. Only the fixed questions, nothing free-text.
  Nothing travels a second hop. Uniform reply timing both ways so no one can
  infer anything from how long you took. Inventory not in scope until you put
  something in it deliberately. The person is hard to put on the spot.
- **Standard**, the default, and it must be genuinely close to Sicher rather
  than a middle setting that quietly opens things up. Free-text asks allowed,
  answers fast and honest about reach, relaying still non-revealing, second hop
  allowed but answers to strangers stay abstract (D29).
- **Pro.** Everything available, including whatever is fastest and most
  revealing. His words are the spec: "i know what i am doing and will nuance
  what i share and talk." So the copy should say plainly what the person is
  taking on, not congratulate them for choosing it.

## How it must behave

- Chosen during onboarding, ON EVERY DEVICE. Jakob picks his; a guest arriving
  by connect link picks hers on the name screen. Do not make the inviter's
  choice apply to the invited person: that would be exactly the coercion the
  feature exists to prevent.
- **Standard is preselected.** A person who taps straight through gets the safe
  thing (invariant I9).
- Changeable afterwards, from the profile or settings, and the current mode is
  visible without hunting for it.
- Every individual switch stays individually settable. A mode is a starting
  posture, not a lock.
- The description of each mode says what will HAPPEN TO THE PERSON in plain
  words, not what setting it flips. "Du kannst gefragt werden, ob ..." rather
  than "free-text queries enabled".

## Constraints

- No em dashes. German first, plain register, the audience is not technical.
- The consent gate, the k-anonymity floor and the byte-identical "no answer"
  are untouched by all three modes. A mode changes what you are exposed to, it
  never weakens what protects an answer.
- Demos 1, 2, 3, 6, 20 and 21 all work today. `seven_steps.mjs` against a
  demo-1 build is the regression check, and demo 20's flat flow plus demo 21's
  second-hop flow must keep passing.
- `tsc --noEmit` and `vitest run` (315 tests) must pass.

## Report

`DEVLOG/result-report-three-modes.md`: the exact posture each mode takes on
every mechanism you found, in a table; the German copy for all three; and
anything you found that can put a person in an awkward position that NONE of
the three modes currently prevents. That last item is the point of the task.
