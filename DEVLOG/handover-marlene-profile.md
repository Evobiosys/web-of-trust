# Handover — Marlene's profile and her own written inventory

Worktree: `/Users/personal/Documents/SingularStructure/PROJECTS/evobiosys/evobiosys-PROJECTS/EvoBioSys-cross/PROJECTS/web-of-trust/Code/wt-marlene`
Branch: `feat/marlene-profile`. Work ONLY in `apps/demo/`.

## Why

Today a persona is a bare name. Everything Marlene "knows" comes from a seeded
WhatsApp export she never wrote. Two gaps close here:

1. **A profile** — who this person is, visible on their own device, and the
   small part of it that a match may reveal.
2. **An inventory she writes herself** — things she has, knows, or can offer,
   typed in by her, that participate in matching **alongside** the chat corpus.

This is the difference between "the app read my chats" and "this is mine and I
put it there". Demo-critical: the room needs to see her add a line and then see
that line found.

## Read first

- `src/types.ts` — the data contract. `ChatThread`, `ChatMessage`,
  `QueryTemplate`, the envelope types.
- `src/match/index.ts` and `src/match/lexical.ts` — how matching works today
  (normalise → stem → compound-split → score over thread messages).
- `src/state.ts` — `DeviceState`, `loadState`/`saveState`, `Peer`.
- `src/gate.ts` — the consent gate and the k-anonymity floor.
- `src/data/templates.ts` — the five query templates and their `kThreshold`.
- `src/db.ts` — the kv store. Note `storageIsEphemeral()`: on a phone with
  blocked storage the demo runs from memory, so **never** assume a write
  survives a reload. The UI may say so; it must not break.

## Task 1 — Profile

Add a `Profile` to `DeviceState`: at minimum display name, a short
self-description ("Was mich ausmacht"), neighbourhood/Grätzl, and languages.
Seed sensible German values for both Nora and Marlene so the demo has content
on first open; make every field editable on the device.

A new screen reachable from the main screen: **„Mein Profil"**. German first
(the app is `de` by default, `en` is the toggle) — add every string to
`src/i18n.ts` in both languages, never inline literals.

**Privacy rule, non-negotiable:** the profile is local. Nothing from it may
enter a `QueryEnvelope` or an `AnswerEnvelope` unless the owner explicitly
consents in the existing Gate-2 step. If you surface any profile field in an
answer, it goes through `src/gate.ts`, never around it. Add a test that proves
a profile field cannot reach the requester without consent.

## Task 2 — Her own inventory

A new screen **„Was ich habe"**: a list Marlene writes herself. Each entry is
free text plus an included/excluded switch, same visual language as the
existing **„Meine Chats"** screen (read that screen first and follow it).

- Entries are stored in `DeviceState` and persist via `saveState`.
- Entries participate in matching **exactly like** chat messages: extend the
  matcher's corpus rather than adding a second scoring path. One code path, or
  the "decoys are not the top hit" guarantee silently stops covering the new
  material.
- Entries respect the **same k-anonymity floor** as chat content. Do not exempt
  them. If an entry is the only thing that matches and k is not met, the answer
  must still be the indistinguishable "no answer" — the existing invariant.
- Default state for a newly typed entry: **included** (she wrote it on purpose),
  unlike 1-on-1 chats which default to excluded. Comment why.
- Seed two or three plausible German entries for Marlene (Vienna, Ottakring
  register — a Bohrmaschine to lend, a Lastenrad, knowing someone at the
  Hausverwaltung), and none for Nora.

## Task 3 — Tests

- Unit: an inventory entry matches a template the same way a chat message does.
- Unit: an excluded entry is unmatchable; re-including it makes it matchable
  (mirror the existing 1-on-1 opt-out test, which asserts both directions —
  a switch is only proven when tested both ways).
- Unit: below the k-threshold, an inventory-only match still yields the
  byte-identical "no answer" payload.
- Unit: a profile field cannot reach a requester without an explicit consent
  event.

## Constraints

- `npx tsc --noEmit -p tsconfig.json` and `npx vitest run` must pass in
  `apps/demo`. The existing 199 tests must stay green — if one goes red, fix the
  cause, do not edit the test to match new behaviour without saying so loudly in
  your report.
- Keep `src/main.ts` edits as small and as localised as you can: another stream
  is editing that file and I have to merge you both. Prefer new modules
  (`src/screens/profile.ts`, `src/screens/inventory.ts` or similar) that
  `main.ts` calls in a few lines.
- No em dashes in user-facing German copy; use plain punctuation.
- Do not start long-lived servers. Do not push to any remote.
- Commit on `feat/marlene-profile`.

## Report

Write `DEVLOG/result-report-marlene-profile.md` in the worktree: what landed,
test counts before and after, the exact `main.ts` lines you touched (so the
merge is cheap), and anything left open. Summarise it in your reply.
