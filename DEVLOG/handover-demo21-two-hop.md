# Handover — demo 21: a question that travels two hops

Worktree: `git worktree add ../wt-demo21 -b feat/demo21`. Work in `apps/demo/`.
Deploy path `/wot/demo21/`, scenario flag alongside demo 20's. Commit locally.

## What the owner asked for

> this computer, which is Jakob, is connecting with a phone, and then there's
> another person, a second phone that connects to the first phone, and that
> second phone then asks for something that lives on the laptop

Three devices in a line:

    Jakob's laptop  <-->  phone A  <-->  phone B

Jakob and A know each other. A and B know each other. **Jakob and B have never
met.** B asks for something, and the thing that answers is on Jakob's laptop.

This is the SECOND HOP, and it is the exact question the founder of the
organisation this is being shown to asked about. Read `docs/query-traversal.md`
before you design anything: it documents what ships today, what a second hop
would mean, and which choices are already settled in `docs/DECISIONS.md`.

## What already exists that you must not reinvent

`packages/agent-daemon` **already implements a two-hop relay and it was run
live**: `daemon.ts`'s `forwardRelay`, decisions D13/D15/D16, and
`verification/alpha-run.txt` leg (g), where Bob asks, Alice relays a note about
Carol, two-hop consent is taken, and Bob ends up connected to Carol with no
prior edge. Read that code and that transcript. The demo app should follow its
consent shape rather than invent a second, looser one.

## The design points you must get right, and state in the UI

1. **Consent at every hop.** A must agree to carry B's question onward. Jakob
   must agree to answer it. Neither is implied by having paired. This is
   invariant I8 (provenance and hop-consent) and D1.6.
2. **What B learns.** B must not silently learn that Jakob exists, nor
   anything about Jakob's other connections. Decide what B sees when an answer
   comes back from someone they have never met, and say it plainly on screen.
   The honest options are a named introduction that Jakob consents to, or an
   answer whose source stays hidden. Pick one, justify it in your report.
3. **What A learns.** A is carrying a question they did not ask and may see an
   answer they were not the audience for. Decide and state whether A sees the
   content.
4. **The indistinguishable no still holds, per hop.** B must not be able to
   tell "A had nobody to forward to" from "A declined to forward" from "Jakob
   declined to answer" from "Jakob had nothing". If your design lets B
   distinguish any of those, it breaks I3 and the whole argument. Prove it in
   a test the way `test/e2e/call_into_the_web.mjs` proves the one-hop case:
   compare actual wire bytes, not just screen text.
5. **No infinite forwarding.** One extra hop, not N. A question must carry
   something that stops it travelling further, and B's device must not be able
   to ask for more hops than the design allows.

## The copy that must change, only in this demo

Demo 20 tells people, correctly, that whoever joins through a link can query
only that device and never further. **That sentence becomes false in demo 21**,
so demo 21 needs its own honest wording describing what actually happens. Do
not change demo 20's copy. Getting this wrong is worse than not building the
feature: the project's credibility rests on the UI never overstating what it
does.

## Constraints

- Demos 1, 2, 3, 6 and 20 keep their exact behaviour. `seven_steps.mjs`
  against a demo-1 build, and demo 20's flat-sharing flow, are the regression
  checks.
- Reuse the existing gate, matcher, k-anonymity floor and relay transport.
- German first, plain register, no em dashes.
- Add `/wot/demo21/` to `scripts/deploy_wot.sh`, following demo 20's opt-in
  pattern if it carries anything sensitive.
- `tsc --noEmit` and `vitest run` must pass.

## Report

`DEVLOG/result-report-demo21.md`: the consent shape you chose and why, exactly
what B and A each learn, the byte-level proof for point 4, a three-device
end-to-end test against the live relay, and anything you could not close.
