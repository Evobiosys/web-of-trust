# Handover — shareable inventory, calling into the web, and the query log

Worktree: `git worktree add ../wt-inventory -b feat/inventory-call`. Work in
`apps/demo/`. Another stream is editing `main.ts` concurrently; keep edits
there small and prefer new modules. Commit locally.

**The owner marked this one important.** It is the difference between a demo
about one flat and a demo about resource sharing.

## What has to work

> make sure that it's possible to share inventory which can then be queried
> against. this works if a person can write the custom 'Ski' as something they
> can borrow, and a person asks for the custom ski into the network

So, end to end:

1. **A writes a free-text item** ("Ski") into their own inventory. The
   "Was ich habe" screen already exists (`src/screens/inventory.ts`) and
   already feeds the matcher through `threadsInScope()` in `state.ts` --
   read both before changing anything. It may already be most of the way
   there; find out rather than rebuilding.
2. **B asks the network for "Ski"** as free text, not from the five fixed
   templates. This is a new capability: today `TEMPLATES` is a closed list,
   deliberately (`data/templates.ts` explains why). Add a free-text ask that
   travels as a query, matches against inventory and chat content on the
   receiving devices, and comes back through the same consent gate.
3. The query goes to **every connected peer**, not just the first. Demo 20 is
   already multi-peer; follow how the accept path resolves peers.

**Name it "call into the web", and in German too.** Pick a German phrase that
a normal person would say. `In die Runde fragen` and `Ins Netz rufen` are both
plausible; choose one, use it consistently, and say in your report why.

## The log, and the deliberate absence of a notification

> for which there shouldn't be a notification, but it should be possible to
> see in a log what has been queried against

- A device that receives a query is **not** interrupted. No notification, no
  screen change, nothing demanding attention.
- Every received query IS written to a **local log**: when, who asked, what
  was asked, and what happened (matched and shared, matched and declined,
  below the anonymity floor, or nothing found).
- The log is local, never sent. This is invariant **I6 Auditability** in
  `CLAUDE.md`, already a project rule, so implement it as that rather than as
  a new idea.
- A screen to read the log. Call it Protokoll.

**The acceptance test the owner named**, and it must actually pass:

> two devices connected to the same link. on one a request should show up and
> on the other not, but on both there should be logs of the query.

In other words: two peers both receive the same query. The one WITH a match
surfaces a consent prompt. The one WITHOUT a match surfaces nothing at all,
silently. **Both write a log entry.** Write that as an automated test against
the live relay, with two independent guest contexts, and put its output in
your report.

⚠️ The log must not become a side channel. It records what THIS device was
asked and what THIS device did. It must never tell a device anything about
what another device answered. If a log entry could let B infer that A had a
match A chose not to share, that breaks invariant I3 and the entire pitch.
Think about this specifically and say in your report how you checked it.

## Constraints

- Consent gate, k-anonymity floor, byte-identical "no answer": unchanged.
  A free-text query is still a query and gets the same treatment. Note that
  free text is a bigger privacy surface than a fixed template, so say plainly
  in the UI what the other side will see of what you typed.
- Demos 1, 2, 3, 6 keep working; `seven_steps.mjs` is the regression check.
- German first, no em dashes. `tsc --noEmit` and `vitest run` must pass.

## Report

`DEVLOG/result-report-inventory-call.md`: the German name you chose and why,
the two-device test output, and your reasoning on why the log cannot leak
what the gate withheld.
