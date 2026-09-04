# Result report -- demo 20 (Geologengasse, Jakob's own flat)

Worktree: `../wt-demo20`, branch `feat/demo20`. Committed locally. **Not
pushed** to any remote -- this repo's own CLAUDE.md says pushing publicly is
expected, but nothing about this demo should reach a public remote without
the owner deciding that separately (see the address discussion below).

## What landed

Built as a second, orthogonal build-time flag next to the existing
`VITE_WOT_MODE`: `VITE_WOT_SCENARIO=geologengasse` (`apps/demo/src/mode.ts`).
Demo 20 is `VITE_WOT_MODE=relay VITE_WOT_SCENARIO=geologengasse`, i.e. demo
2's exact transport with demo 20's own screens and rules layered on top.
Every scenario-gated branch is a no-op when `VITE_WOT_SCENARIO` is unset, so
demos 1/2/3/6's code paths run byte-identically to before -- verified, not
assumed (see "Testing" below).

- **The laptop is Jakob, no picker.** `boot()` auto-seeds a fixed `Jakob`
  identity the moment a fresh visit has the scenario on, no pending connect
  link, and no existing state -- i.e. this IS the laptop's first open, not an
  invited phone (which always arrives WITH a connect link).
- **The invited device asks for a free-text name**, not a persona
  (`screenGeoNameEntry`), and uses it as the identity for that device's own
  `Identity.id`/`displayName` from then on.
- **The laptop must explicitly accept.** Connect-acks no longer auto-upsert a
  peer in this scenario; they land in `pendingAcceptRequests` (a list, see
  "the scope addition" below) and wait, visibly, for a tap on **"Anfrage
  bestätigen"** -- a new i18n key, used only in this scenario. No equivalent
  confirm action existed anywhere else in the codebase to rename (grepped
  the whole repo for "bestät" before writing anything: zero hits) -- the
  existing demos' connect-link ceremony auto-accepts silently, by design,
  and that is unchanged, per "demos 1/2/3/6 keep their exact behaviour."
- **The trust graph** (`apps/demo/src/data/geologengasse.ts`,
  `main.ts#screenGraph`): plain SVG, concentric rings, following
  `overnight/stub/trust-graph.html`'s visual grammar (dashed rings, filled
  avatar circles, "Du" fixed centre) at a fraction of its interactivity.
  Seeded with Jakob at the centre, Alex on ring 1, Alex's friend on ring 2
  (via Alex, not invented a name for a real person this app has never met),
  and one "?" placeholder on ring 1. Every accepted peer renders as an
  additional live ring-1 bubble, reactively, the moment `acceptPendingRequest`
  saves state and re-renders -- no reload.
- **The query**: a new template (`apps/demo/src/match/accommodation.ts`),
  matched by a small dedicated function (`matchAccommodation`), never a fork
  of `match/lexical.ts`. `k = 1` (the corpus is one flat), said honestly in
  the UI under the template card (`geoKHonesty`), not left implying a floor
  that isn't there. The answer text ("yes, we're away 26 Oct-1 Nov, here's
  the address") is built unconditionally into the match hit the moment a
  query is matched -- same architecture every other template already uses,
  where `gate.ts` builds the "what would we share" payload regardless of
  consent to keep the four `nothing` reasons timing-indistinguishable -- but
  this one template's consent screen never offers the "Zeigen, was geteilt
  würde" reveal at all, so the address is never rendered to the DOM before
  Jakob taps "Ja, teilen."
- **The honest chaining limit**: read `docs/query-traversal.md` in full
  before writing this. Section 1a states the public demo app "has no trust
  graph at all" and pairs exactly one device to another; hop 2 exists only
  in `packages/agent-daemon`, unmounted here. The UI says this in two
  places: on the connect-link QR screen itself (`connectLinkHonesty` +
  appended `geoChainHonesty`) and again on the laptop's connect screen
  whenever the link button is shown. Wording: "whoever joins through this
  link can only query THIS device, never you." Verified in the live test
  below that this string is actually on screen at the moment the link is
  shown, not just present in i18n.ts.

### The scope addition (several people, not two devices)

Mid-task the owner clarified the real ask: one excited relative pairs with
the laptop, then forwards the same link to her friends, and each of them
should independently query Jakob and get a real hit. That changes a load-
bearing assumption: `apps/demo`'s whole architecture (and `relay.ts`'s own
module header) previously said "exactly one pair key alive at any moment."

What changed, and what did not:

- `state.ts#upsertPeer` already appended rather than replaced -- no change
  needed there.
- `relay.ts#onEnvelope` used to take exactly one fixed `CryptoKey`. It now
  ALSO accepts a `PairKeyResolver` function (`(fromDid) => CryptoKey | null`)
  that looks up the right peer's key per inbound wire. Passing a plain
  `CryptoKey`, as demos 1/2/3/6 still do, is defined to be exactly equivalent
  to `() => thatKey` -- byte-identical behaviour, confirmed by
  `test/relay.test.ts`'s 19 existing tests passing unmodified.
- `registerRelaySink()` in `main.ts` now branches on scenario: default is
  the original single-peer registration, unchanged; geologengasse registers
  a resolver closing over `state.peers`, so newly accepted peers are covered
  without needing to re-register (though `acceptPendingRequest` still calls
  it again, belt-and-suspenders).
- The answer-routing side (`runConsentCeremony`'s `s.peers.find(p => p.id
  === q.from.id)`, `emitAnswer`, `sendAnswerOverRelay`) was ALREADY
  multi-peer-safe -- it never assumed `peers[0]`, it always looked the
  answering peer up by the asker's own id. Only the DECRYPT side had a
  single-peer bottleneck.
- `pendingAcceptRequests` became a list, keyed by `did`, each with its own
  accept/decline. `pendingGeoQueries` is a small FIFO queue so a second
  guest's question arriving while Jakob is mid-decision on a first one is
  never silently dropped (found this exact bug live -- see "Testing" below,
  and `geoCeremonyBusy`'s doc comment in `main.ts` for the fix).

Confirmed for the record, since it was explicitly asked: **no native app, no
download.** This is, and remains, a browser page. Everything a person's
device knows lives in that device's own IndexedDB (`db.ts`), with an
in-memory fallback for a browser that blocks site storage (GrapheneOS/
Vanadium; the demo still runs, `storageIsEphemeral()` just says so out
loud). Nothing about the multi-peer work touches this.

## Testing

**`npx tsc --noEmit` and `npx vitest run`**: both pass, run repeatedly
through the session, last run 279/279 tests green across 20 files.

**`seven_steps.mjs` against an actual demo-1 build** (no `VITE_WOT_MODE`, no
`VITE_WOT_SCENARIO` -- `WOT_BASE=/wot/demo1/`, served from a real `vite`
dev server, driven with real Playwright/Chromium, not a mock): all 22 checks
pass, run twice (once before, once after the multi-peer concurrency fix).
Demo 1's behaviour is unchanged.

**A real end-to-end walk against a locally-run relay** (`packages/transport
/relay_only.ts` on `localhost:4177` -- the same `RelayServer` code
questhub.eco runs in production, not a mock; a temporary dev-only Vite proxy
made the CORS-locked `POST /relay/send` work from `localhost:5181`, reverted
before committing, see the diff), scripted with Playwright, laptop plus TWO
separate guest browser contexts:

1. Laptop opens the app: no persona picker, lands on home as Jakob.
2. Laptop shows the connect link: no address in the link's own URL text;
   the chaining-honesty line is actually on screen.
3. Guest 1 ("Kaja") opens the link: sees a name field, not a persona picker;
   types the name; taps "Anfrage senden."
4. Guest 2 ("Elena") opens the SAME link independently, does the same.
5. Laptop shows TWO separate pending-request cards, one per name, confirmed
   one at a time with "Anfrage bestätigen" each.
6. Graph screen shows Alex, the "?" placeholder, AND both Kaja and Elena as
   live ring-1 bubbles.
7. Kaja asks: sees only the accommodation template (not the five chat
   templates), sees the k=1 honesty line. Laptop is routed to the consent
   screen automatically, shows "Kaja fragt," the address is NOT in that
   screen's text, there is no "Zeigen, was geteilt würde" button for this
   template, and the free-window date range is shown instead. Jakob taps
   "Ja, teilen." Kaja's screen shows a "shared" outcome with the real
   address and the free-window dates.
8. Elena asks too, independently, afterward: gets her own consent ceremony
   on the laptop (names her specifically) and her own shared answer with the
   address.

All 26 checks pass. This is the strongest evidence in this report: it is a
live walk of the actual shipped code over a real relay server, not a unit
test of pieces.

**Bug found and fixed during this walk, worth recording precisely**: the
first version of the concurrency handling checked `screen !== 'answer'`
before deciding whether to interrupt with a newly arrived query. That is
wrong -- `runConsentCeremony`/`emitAnswer` draw the checking/consent/"sent"
beats with direct `shell()` calls, never through `go()`, so `screen` sits
frozen at `'answer'` for the ENTIRE ceremony including its final confirmation
screen. A second guest's query arriving during that window queued silently
and never surfaced, with no visible way to reach it short of guessing to tap
"Anfrage beantworten" again. Replaced with an explicit `geoCeremonyBusy`
flag, true only while a human decision is actually pending. Reproduced,
fixed, and reverified live (Elena's follow-up query above).

## Address verification, done deliberately, not asserted

Constraint 1 (never the exact address anywhere except a consented answer)
got its own design decision, not just a check:

- `ADDRESS` (`data/geologengasse.ts`) is NOT a string literal. It reads
  `import.meta.env.VITE_WOT_ADDRESS`, a build-time env var, falling back to
  a neutral "(keine Adresse gesetzt)" message that names no real place.
- **Why this had to change from a plain constant, found by testing, not by
  inspection alone**: `data/geologengasse.ts` is statically imported by
  `main.ts` regardless of scenario, so a plain string constant there ships
  in EVERY demo's build output, including demo 1's -- confirmed directly:
  `WOT_BASE=/wot/demo1/ npx vite build && grep -rl "Geologengasse" dist/`
  found the literal in demo 1's bundle before this fix, and finds nothing
  after it. This would have meant the address sat, unused but present, in
  the JS of demos that are being shown to people TODAY, the moment anyone
  rebuilt them from this branch. Fixed, and now:
  - `WOT_BASE=/wot/demo1/ npx vite build` -> `grep` finds nothing in `dist/`.
  - `VITE_WOT_ADDRESS=... VITE_WOT_MODE=relay VITE_WOT_SCENARIO=geologengasse
    WOT_BASE=/wot/demo20/ npx vite build` -> the address IS in
    `dist/assets/*.js` (necessarily -- see the decision below), and NOT in
    `dist/index.html`.
  - `VITE_WOT_MODE=relay VITE_WOT_SCENARIO=geologengasse npx vite build`
    (address env var omitted) -> the neutral fallback ships, no leak, no
    crash.
- `grep -rn "Geologengasse" apps/demo/src` finds it in exactly two places,
  both comments (never compiled into any bundle): this file's own module
  doc, and one example command in `env.d.ts`. No `.ts` file contains the
  address as a value.
- In the live test above: the connect-link URL text contains no address;
  the pre-consent "gefunden" card and the laptop's whole screen state before
  the "Ja, teilen" tap contain no address (asserted directly against the
  rendered `innerText()`, not inferred); the address appears for the first
  time, anywhere, in the asker's screen AFTER Jakob's explicit tap.
- The one place a house number would need to exist for the app to be USABLE
  today is `VITE_WOT_ADDRESS`, and I do not have the real one -- the
  handover names the street, not the door. Placeholder used throughout
  testing: `Geologengasse [Hausnummer einsetzen], 1030 Wien`. Never written
  to any tracked file; supplied only as a shell env var at build/deploy
  time (see `scripts/deploy_wot.sh`'s new demo20 block).

## The deploy script

`scripts/deploy_wot.sh` gained an opt-in demo20 block: a plain run of the
script (the one that refreshes demos 1/2/3/6 today) never builds or
touches demo 20 at all, and never requires `VITE_WOT_ADDRESS`. To include
it: `DEPLOY_DEMO20=1 VITE_WOT_ADDRESS="<real address>" ./scripts/deploy_wot.sh`.
Missing the address var with `DEPLOY_DEMO20=1` set fails loudly before
building anything, rather than shipping the neutral fallback message to a
live audience by accident.

Not run against the real questhub host this session -- no reason to push a
public URL carrying a placeholder address, and pushing the real address
publicly is a decision only the owner should make explicitly (see below).

## What's left open

- **The real house number.** Everything else works against the placeholder;
  swap `VITE_WOT_ADDRESS` for the real value at build/deploy time whenever
  it is known -- one env var, nothing else to touch.
- **Demo 20's own bundle still contains the address in cleartext once
  built.** This is architecturally unavoidable for a fully client-side app
  that has to answer with it locally -- there is no server-side secret to
  hide it behind. If demo 20 is ever deployed to a public URL
  (`app.idea2.site/wot/demo20/`), anyone with that URL can read the address
  out of the JS bundle, whether or not they ever complete the query flow.
  The scenario said "don't publish this" -- treat that as still standing
  until told otherwise, not something this report resolves.
- **Pending requests and queued queries do not survive a page reload.**
  `pendingAcceptRequests` and `pendingGeoQueries` are in-memory only, not
  written to IndexedDB. If Jakob's laptop tab reloads (or crashes) between a
  guest sending their request and him tapping "Anfrage bestätigen," that
  request is gone and the guest has to re-open the link. Same for a query
  queued mid-ceremony. Not fixed this session -- flagged rather than
  silently left for someone to discover live.
- **The live chat/ping screen ("Jetzt schreiben") still only talks to
  `peers[0]`.** With several peers this only reaches whichever was accepted
  first. Not part of the query path the priority order asked for; left
  alone rather than risking the higher-priority work for it.
- **The bubble layout is intentionally plain**, per the stated priority
  order (querying first, accept + live graph update second, visual polish
  last). Ring-2 nodes anchor near their parent's angle rather than running
  a real force layout; legible from a couple of metres, not decorative.
- **Real house number aside, the German copy has not been read aloud to the
  owner.** Written in the app's existing plain register, no em dashes,
  cross-checked against `src/i18n.ts`'s existing tone, but not proofread by
  a native-speaker pass beyond that.
