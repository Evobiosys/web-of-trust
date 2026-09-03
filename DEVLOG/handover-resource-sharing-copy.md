# Handover — retire the ecstatic-dance framing in the mobile-UI app

Worktree: `git worktree add ../wt-copy -b feat/resource-sharing-copy`.
Work in `apps/mobile-ui/` and `packages/app-profiles/` only. Commit locally.

## The task

`apps/mobile-ui` still opens with **"Step onto the floor"** and category chips
reading **"This week, Ecstatic Dance, Biodanza, Contact Improv, Hangouts"**.
The demo app was neutralised to a Vienna resource-sharing frame months ago;
this app never was. It is now published at a URL people will open.

Rewrite that copy into a **resource-sharing frame**: the app is for asking the
people you actually know for things that are not findable online, and offering
what you have. Read `apps/demo/src/i18n.ts` and `apps/demo/src/data/templates.ts`
first — that is the register and subject matter to match (housing, tools,
a doctor taking patients, childcare, trades). Do not invent a new vocabulary
when a neutral one already exists in this repo.

Sources of the strings: `apps/mobile-ui/src/skin.js`
(`DEFAULT_ONBOARDING_HEADING` and the chip list) plus whatever
`packages/app-profiles` supplies per skin. Find them all; the tests in
`skin.test.js` pin several, so they must be updated in step.

⚠️ There are four app profiles (ecstatic / housing / family / business). The
**ecstatic profile keeps its own wording** — that skin exists for that
audience. What changes is the **default**: opening the app with no `?app=`
parameter must land on the neutral resource-sharing frame, not on the dance
one.

## The honorary mention

The owner asked for the old wording to be kept as **a collapsed note, marked as
an honorary mention directed at ecstatic.world**. So: a `<details>`-style
collapsed block somewhere sensible in the app (an About or Info surface, not the
first screen), showing the original "Step onto the floor" wording and crediting
ecstatic.world as where this framing came from and who it was written for.
Warm, short, not an apology. It is a nod, not a changelog entry.

If there is no About surface to hang it on, add a minimal one rather than
forcing it somewhere it does not belong, and say so in your report.

## Constraints

- `npx tsc --noEmit` and the app's tests must pass. Update pinned test strings
  rather than deleting the assertions.
- No em dashes in user-facing copy.
- Do not touch `apps/demo`. Another stream owns it.

## Report

`DEVLOG/result-report-resource-sharing-copy.md`: every string changed with
before/after, where the honorary mention lives, and test results.
