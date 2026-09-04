# Handover — demo 20: Jakob's own flat, his own web of trust

Worktree: `git worktree add ../wt-demo20 -b feat/demo20`. Work in `apps/demo/`.
Commit locally; pushing this repo is fine. Deploy path `/wot/demo20/`.

This is the owner demoing HIS OWN real situation to real people, today. Not a
fictional persona. Read the whole document before starting.

## The scenario, from the owner

> the laptop is me and we have an apartment in geologengasse vienna, don't
> publish this but they can query for a place to stay for a bit in vienna,
> when we are not there, which we will put on a private calendar. i will give
> them the exact address when i am connected. and the person scanning with
> phone can enter their name and then is added to my web of trust

Concretely:

- **The laptop is Jakob.** No persona picker on that side. It is his device,
  his flat, his graph.
- **The flat**: Geologengasse, Vienna. The exact address is **never** in a
  query, never in a listing, never on screen before he explicitly shares it.
  It appears only in an answer he consented to send.
- **A private calendar** holds when the flat is free. Seed it so the flat is
  free **26 October to 1 November 2026** and occupied otherwise. The calendar
  is local, is never sent, and is what a query matches against.
- **The answer to a match** is: yes, we are away, the flat can be used 26 Oct
  to 1 Nov, and here is the exact address. All of that only after he taps
  share.

## The invited person

A phone opens the connect link (this already works, see `connect_link.ts` and
demo 2). What changes for demo 20:

- **No persona picker.** The invited device asks for a NAME, free text, and
  uses it as their identity. The owner will test this by typing `Kaja`.
- After they enter a name, the device sends the connection request.
- **The laptop must explicitly accept.** New step, and the button is labelled
  **„Anfrage bestätigen"**. Nobody joins his graph without him tapping that.
  Default is not-accepted; a pending request waits visibly.
- Only on acceptance is the person added to the trust graph.

Also rename the equivalent confirm action in the existing demos to
**„Anfrage bestätigen"** where it is the confirmation for someone arriving by
connect link, so the wording is consistent across demos. Check with the owner's
existing German strings in `src/i18n.ts` and do not invent a second phrasing.

## The trust graph, visualised

On the laptop, a bubble view. The owner's reference is the ecstatic.world
visualisation of multiple bubbles; `overnight/stub/trust-graph.html` in this
repo is a runnable stub, look at it first and follow what is good in it.

Seed it with his real situation:

- **Jakob** in the centre.
- **Alex**, a friend, connected to him.
- **Alex's friend**, connected to Alex, who actually stays at their place.
  This is a real case, so render it as a second-ring person, not a first-ring
  one. The distance in the picture should mean something.
- **One more bubble with a question mark**, standing for someone not yet known.

When a scan is accepted, the new person appears in the graph as a first-ring
bubble, live, without a reload. That moment is the demo.

Plain SVG. No charting library. It has to be legible on a laptop screen from a
couple of metres away, because people will be looking at it over his shoulder.

## The querying, which is the point

Everything above is scaffolding for this. The invited phone must be able to ask
for a place to stay in Vienna and get a real answer back over the relay. Reuse
the existing machinery exactly: `gate.ts`'s consent gate, the k-anonymity
floor, the byte-identical "no answer", the relay transport from demo 2. Add a
query template for a place to stay; do not fork the matcher.

⚠️ **The k-threshold.** The other demos use 1 so something is always found.
Here the corpus is one flat and one calendar, so k must be 1 or nothing can
ever match. That is fine for a demo and it is already the documented
demo-crutch, but say it in the UI honesty line rather than letting anyone
believe an anonymity floor is protecting this.

## Chaining, and the honest limit

> and this phone can then show its own qr code to someone else and so forth

So an invited device must also be able to show its OWN connect link and bring
in a third person. That works today: each link is one pairing.

⚠️ **But do not let the UI imply more than that.** A third person paired to the
phone can query THE PHONE. They cannot query Jakob through it: that is a
second-hop query, and `docs/query-traversal.md` (read it) documents that hop 2
exists in the agent daemon but is NOT in this demo app. If you surface chaining
at all, say plainly that a question reaches the person you paired with, and no
further. Getting this wrong would be the worst possible failure in front of
this audience, because the whole pitch is that the app tells the truth about
what it does.

## Constraints

- Demos 1, 2, 3 and 6 keep their exact behaviour. `seven_steps.mjs` must still
  pass against a demo-1 build.
- German first, plain register, no em dashes. The audience is Viennese.
- The address string must exist in exactly one place in the source, so it can
  be changed or removed in one edit.
- Add `/wot/demo20/` to `scripts/deploy_wot.sh` following the existing pattern.
- `npx tsc --noEmit` and `npx vitest run` must pass.

## Report

`DEVLOG/result-report-demo20.md`: what landed, an end-to-end test against the
live relay covering scan link, name entry, accept, graph update and a real
query with the address in the answer, and anything left open.
