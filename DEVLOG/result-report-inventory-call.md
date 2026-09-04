# Result report -- shareable inventory, calling into the web, and the query log

Worktree: `../wt-inventory`, branch `feat/inventory-call`. Committed locally,
not pushed to any remote. Work confined to `apps/demo/` as instructed.

## The name: "In die Runde fragen"

Chose **In die Runde fragen** over **Ins Netz rufen**. "Ins Netz rufen" is
the more literal rendering of "call into the web," but it reads as
website-technical, not something a person actually says. "In die Runde
fragen" is exactly what someone types when posting a question into their
neighbourhood WhatsApp group -- and this app's own personas already live in
that register (`state.ts`'s Marlene: "Ist in einer Grätzl-Gruppe im 16.
Bezirk"). The owner's brief said "a normal person would say," not "the
closest translation of the English title," so idiom won. Used consistently:
the ask-screen card title and submit button, the network waiting/result
screen, and the log entry format all say it or nothing at all (the log
itself never names the feature, only records what happened).

## What landed

1. **Point 1 (write "Ski" into inventory) needed no change.** Read
   `src/screens/inventory.ts` and `state.ts` first, as the handover asked.
   `threadsInScope()` already folds `inventory` into the matcher's input
   stream via `inventoryThreads()`, on the exact same scoring path as an
   imported chat message. Confirmed with two new unit tests in
   `test/inventory_match.test.ts` before touching anything else.

2. **Free-text ask** (`src/data/free_text_query.ts`): `freeTextTemplate(text)`
   builds an ordinary `QueryTemplate` from whatever B types -- matchTerms are
   the typed words (minus a small closed stopword list), everything else
   (boost/exclude/minScore/sensitivity/ttl) mirrors the existing templates'
   shape. No second matcher, no second consent path: `matchTemplate()`,
   `gate.decide()`/`interpret()`, the k-anonymity floor, and the
   byte-identical-PASS discipline are all completely unaware this template
   was typed rather than picked from `data/templates.ts`.

   `kThreshold` is a **DEMO OVERRIDE of 1**, same labelling `data/templates.ts`
   uses for T1 -- and for a structural reason, not convenience:
   `inventoryThreads()` gives every "Was ich habe" entry exactly one author
   (the device's own owner), so an inventory-only match has
   `distinctAuthors === 1` by construction. A floor above 1 makes sharing a
   single inventory entry impossible, ever, which would kill the owner's own
   story outright. Flagged in the module's own doc comment and here, not
   shipped as a real k value (I7).

   `types.ts`'s `QueryEnvelope` gained an optional `freeText` field;
   `wire.ts`'s `parseQuery` bounds it to `FREE_TEXT_MAX_LEN = 200`, same
   discipline as `ChatEnvelope.text`. The ask screen states plainly, in
   German, that the other side sees the name and the typed sentence
   verbatim -- free text is a bigger privacy surface than a curated
   template's fixed vocabulary, and the UI says so rather than hedging.

3. **Broadcast to every connected peer, not just the first.** `askWith()`
   now sends to every relay-reachable peer (`s.peers`, filtered to those with
   a `did`) when more than one exists, via a new `askNetwork()`, one qid per
   peer. This needed two structural generalisations, both behaviourally
   identical to the old code for every single-peer demo (1/2/3/6):
   - `registerRelaySink()` now always uses relay.ts's `PairKeyResolver`
     (previously only demo 20's geologengasse scenario did this; every other
     scenario pinned exactly one fixed key, which would have silently failed
     to decrypt a second peer's traffic).
   - The single-slot `awaitingAnswer` became `awaitingAnswers`, a
     `Map<qid, resolve>` -- a shared single slot cannot represent two
     concurrent waits, which broadcasting to N peers requires.
   The waiting screen shows a static "asked N people" count and, once
   answers land, names only the peer(s) who actually shared -- never a live
   per-peer breakdown of who has/hasn't answered (see the I2 section below).

4. **Silent-unless-matched receiving.** A query arriving ambiently (relay/
   webrtc, nobody scanned anything) no longer unconditionally jumps to the
   consent screen. `src/incoming_query.ts`'s `classifyIncomingQuery(match,
   blocked, templateResolved)` is a small, pure, DOM-free function that
   returns `{surface, outcome}` -- `main.ts`'s new `handleAmbientQuery()`
   calls it and only then decides whether to queue/navigate (`surface:
   true`) or answer automatically with `consent: false` and no render at all
   (`surface: false`). A **manual** scan (`scanQuery()`, `runConsentCeremony`
   called directly) is unchanged and always surfaces, deliberately: choosing
   to scan a query IS choosing to look, so there is no silent version of
   that path and none was added.

   `emitAnswer()` gained `opts.silent`, threaded all the way into
   `sendAnswerOverRelay`/`sendAnswerOverWebrtc`. On first pass I wrote
   `silent` as a flag on `emitAnswer` alone and left the two send helpers'
   own success/failure screens untouched -- which would have flashed
   "Antwort gesendet" on the exact device that is supposed to show nothing.
   Caught before shipping (the advisor flagged it explicitly); fixed by
   suppressing every render in both helpers when `silent` is set, with no
   QR fallback in that mode (a code on screen is definitionally not silent).

5. **The local query log ("Protokoll").** `types.ts`'s `QueryLogEntry`
   (`at`, `fromDisplayName`, `fromId`, `text`, `outcome`), `state.ts`'s
   `appendQueryLog()`, a new `screenLog()`, and a "Protokoll (N)" button on
   the home screen. Every received query is logged -- including one this
   device cannot resolve into a real question at all (a synthetic
   `UNRESOLVED_TEMPLATE` lets `decide()` still run and still produce a
   logged, byte-identical PASS, rather than the query being dropped
   silently, which is what the old `if (!tpl) return` branch did).
   `appendQueryLog()` is called from `emitAnswer()` strictly **after** the
   transport dispatch returns -- after the wire message has already gone
   out, or the QR is already on screen -- specifically so the log write's
   own cost can never shift when the answer leaves the device.

## Why the log cannot become a side channel, and how I checked it

The risk stated in the handover: if a log entry could let B infer that A had
a match A chose not to share, I3 breaks. Three separate arguments, the last
one mechanically verified rather than reasoned about only in prose:

1. **What an entry names.** A `QueryLogEntry` names only THIS device's own
   asker (`fromDisplayName`/`fromId`) and THIS device's own decision. It has
   no field that could name another device, another peer, or another
   device's match state -- there is nothing in the type for it to leak
   through even by accident. I4 (contextual consent) already grants the
   owner the asker's identity and request text before any decision is made;
   recording that locally teaches nobody anything the protocol had not
   already told this exact device.

2. **Where an entry is read.** `screenLog()` is a screen, not an endpoint --
   nothing serialises `queryLog` onto any wire, and `gate.ts`'s
   `AnswerEnvelope` has no slot for it (frozen shut by
   `test/gate_identity.test.ts`, which this branch does not touch).

3. **Timing.** `appendQueryLog()` runs after the transport dispatch, not
   before or interleaved with it, so its cost is provably outside the window
   `gate.ts`'s `settleAt(t0, GATE_BUDGET_MS)` equalises. It cannot shift when
   the wire message goes out because it only ever runs once that has already
   happened.

The mechanical check, in `test/e2e/call_into_the_web.mjs` (live relay): the
SAME key and qid are used to run `gate.decide()` twice -- once for a real
match Marlene declines to share, once for a genuine no-match. The resulting
`AnswerEnvelope.body` strings are asserted byte-identical, AND (stronger)
the two are decrypted and their plaintexts are asserted byte-identical --
not just equal ciphertext length, which is true by construction and would
prove nothing new. The two devices' `appendQueryLog()` entries for that
exact same pair are then asserted to differ (`declined` vs `no-match`) --
proving the log distinguishes exactly what the wire is built not to. A
grep-level check on every envelope this script actually sent over the wire
confirms none of the five `LocalOutcome` label strings
(`shared`/`declined`/`below-k`/`no-match`/`blocked`) appear anywhere in
transmitted JSON.

## The two-device acceptance test, against the live relay, real output

`test/e2e/call_into_the_web.mjs`, run with `npx tsx`, against
`https://questhub.eco` (the project's live relay). Two independent guest
identities (Marlene, Ben) plus the asker (Nora), all real `createIdentity()`
DIDs, all traffic actually encrypted/sent/received over the relay -- no
mocked transport. Marlene's device is built with a real "Was ich habe" entry
via `state.ts`'s own `addInventoryItem()`; Ben's has an unrelated entry
(proving a genuine no-match, not an empty-inventory special case). Ran
twice for stability; both runs identical modulo timestamps/durations. Second
run's full stdout:

```
call_into_the_web: targeting https://questhub.eco
  PASS  all three drains authenticated (two independent guest contexts, Marlene and Ben, plus the asker)
  PASS  Marlene received the broadcast query over the relay
  PASS  Ben received the SAME broadcast query over the relay
  PASS  both queries carry the free text verbatim
  PASS  Marlene's device really has a match ("Ski" found in her own inventory)
  PASS  Marlene's match clears the anonymity floor (demo override, structural: inventory is one author)
  PASS  Ben's device really has nothing matching "Ski"
  PASS  on Marlene's device, a request surfaces (classifyIncomingQuery -- the actual app decision, not a proxy for it)
  PASS  on Ben's device, NO request surfaces -- no notification, no screen change
  PASS  Ben's silent classification is logged as no-match, not dropped
  PASS  Marlene's gate outcome really is "shared"
  PASS  Ben's gate outcome really is "no-match"
  PASS  Nora received an answer from Marlene
  PASS  Nora received an answer from Ben
  PASS  Nora decodes Marlene's answer as "shared"
  PASS  Nora sees the Ski item, verbatim
  PASS  Nora decodes Ben's answer as "nothing" (not distinguishable from a decline)
  PASS  Marlene's local log has exactly one entry, outcome "shared"
  PASS  Ben's local log has exactly one entry, outcome "no-match"
  PASS  both log entries name only THIS device's own asker (Nora), never each other
  PASS  [side-channel check] declined and no-match, same key/qid: outcomes really differ locally
  PASS  [side-channel check] the two ANSWER ENVELOPES are byte-identical on the wire
  PASS  [side-channel check] the DECRYPTED PLAINTEXTS are also byte-identical (not just ciphertext length)
  PASS  [side-channel check] the LOCAL LOG, unlike the wire, DOES distinguish declined from no-match
  PASS  none of the five LocalOutcome labels appear anywhere in any envelope actually sent over the wire

Total wall time: 1173ms

All assertions passed.
```

25/25 assertions passed against the real relay, real crypto, real matcher.

One deliberate design choice inside the test worth stating: Nora's channel
is paired to two peers, so it needs the SAME `PairKeyResolver` shape
`registerRelaySink()` uses (a fixed single key only ever covers one peer,
and a second `onEnvelope()` call with a different fixed key silently
replaces the first -- I hit this as a real timeout on the first run, not a
theoretical concern, before switching to the resolver form).

## Regression

- `tsc --noEmit -p tsconfig.json`: clean.
- `vitest run`: **292 passed** (was 279 before this branch; +13: a new
  `incoming_query.test.ts`, two new Ski-story cases in
  `inventory_match.test.ts`, six new `freeText` round-trip/reject cases in
  `wire.test.ts`, plus `queryLog: []` added to every existing `DeviceState`
  test fixture).
- `test/e2e/seven_steps.mjs` (demo 1, QR mode, the regression check the
  handover names): **23/23 PASS**, unchanged, run against a live dev server
  from this worktree both before touching any code (baseline) and after.
- `test/e2e/relay_query_answer.mjs` and `connect_link_relay.mjs` (existing
  live-relay proofs for demo 2 and the one-scan ceremony, neither of which
  touches any file this branch changed): both still pass in full.
- `vite build` succeeds for demo 1 (`WOT_BASE` only), demo 2
  (`VITE_WOT_MODE=relay`), demo 6 (`VITE_WOT_MODE=ladder`), and demo 20
  (`VITE_WOT_MODE=relay VITE_WOT_SCENARIO=geologengasse`).

## Known residual, stated plainly

No browser-driven (two live Playwright contexts) confirmation of the
silent-vs-surfaced DOM behaviour exists yet. Every live-relay proof already
in this repo, including the new one, runs the app's real modules directly in
Node rather than through a browser page -- `relay.ts`'s send/onEnvelope are
origin-locked to the relay's own CORS policy, and a page not actually served
from questhub.eco cannot exercise that transport at all (see
`connect_link_relay.mjs`'s own header comment; this is an existing,
documented constraint of this codebase, not one introduced here).
`seven_steps.mjs`'s QR-mode run exercises the shared
`runConsentCeremony`/`emitAnswer` code path end to end through the real DOM
(minus the new `silent` branch, which QR mode never takes), which is the
closest existing coverage of the rendering path. `gate.ts`'s already-
documented human-deliberation timing gap (`settleAt`'s own doc comment) is
untouched by this work and remains open.
