# Result — retire the ecstatic-dance framing in mobile-ui

Worktree: `../wt-copy`, branch `feat/resource-sharing-copy`. Touched only
`apps/mobile-ui/` and `packages/app-profiles/`, as scoped.

## The actual bug

`apps/mobile-ui/src/runtime_config.js`'s `DEFAULTS.appId` was still
`"ecstatic"` — mobile-ui's own default, separate from (and missed by)
device-ui's default flip in commit c1be3ff ("alpha: replace dance framing
with a neutral Vienna housing scenario"). That commit had already partly
neutralised `apps/mobile-ui/index.html`'s literal markup (chips, the "Roof"
H1) but never touched the JS-level default profile, `skin.js`'s hardcoded
strings, or the vanilla-JS fixture seed in `api_client.js` — which is what a
bare load in fixture mode (the default mode) actually renders. That mismatch
is also why `skin.test.js`'s "ecstatic (no-op)" test was failing before this
change: index.html's chips had drifted neutral while the test still pinned
the dance chips.

## Fix: `housing` is now the default; `ecstatic` keeps its own wording

- `runtime_config.js`: `DEFAULTS.appId` `"ecstatic"` → `"housing"`. A bare
  load with no `?app=` now lands on the neutral Vienna resource-sharing
  frame (bilingual "Wer hat ein Dach frei? / Who has a roof to share?" from
  the existing `housing` profile), same as device-ui and apps/web already do.
- `ecstatic` no longer relies on being a structural no-op that happens to
  match whatever's hardcoded in `index.html`. It now carries its own
  `mobile.onboardingHeading` ("Step onto the floor") and `mobile.offerChips`
  (`["Ecstatic Dance", "Biodanza", "Contact Improv", "Hangouts"]`) on
  `packages/app-profiles/src/ecstatic.ts`, added a new `onboardingHeading`
  field to `MobileSkin` (`packages/app-profiles/src/types.ts`) for this.
  `?app=ecstatic` still renders exactly the dance UI it always did; nothing
  about that skin's own copy changed.
- `skin.js`'s `applyOnboardingHeading` is now
  `profile.mobile?.onboardingHeading ?? profile.heading` — one rule for every
  profile, ecstatic included, instead of an `id === "ecstatic"` special case.
  Also dropped the ecstatic-only early returns in `applyCssVars` /
  `applyBrandHeader` (harmless: ecstatic's `fuchsia-500`/`zinc-950` theme
  tokens aren't in `TAILWIND_HEX`, so no override gets set anyway — verified
  by `skin.test.js`'s `--violet`/`--linen` assertions, which still pass).

## Copy rewritten into the resource-sharing frame

Read `apps/demo/src/i18n.ts` and `apps/demo/src/data/templates.ts` first for
register (housing pre-listing, a doctor taking patients, tradespeople,
childcare) and reused it rather than inventing new vocabulary. The mobile-ui
fixture (`api_client.js`) is a separate, parallel demo world from
`apps/demo`'s — flagged as "residual" in c1be3ff — so it needed its own pass
rather than reuse. Kept every internal id (`lucia`, `rafa`, `maria`, `sofia`,
`bruno`, `tomas`, `speakers`, `djtable`, `venue`) and every person's display
name unchanged — those are pinned by several tests and aren't themselves
dance-specific. Renamed `cacao` → `drill` (the "1kg ceremonial cacao" item
was the one piece of inventory that was inescapably New-Age/ecstatic-coded).

| Where | Before | After |
|---|---|---|
| `skin.js` `applyBrandHeader` (all profiles) | `${brand} — the trust prototype, in your hand` | `${brand} · the trust prototype, in your hand` (dropped an em dash while touching this line) |
| `index.html` `<title>` / `<h1>` | `Roof — Web of Trust Mockup` / `Roof — the trust prototype…` | `Roof · …` / `Roof · …` |
| `api_client.js` `EVENTS_SEED` (4 public gatherings) | Ecstatic Dance Palermo · Biodanza — Casa Luna · Contact Improv Jam · Cacao & Movement Hangout | Nachbarschaftsfest Yppenplatz · Reparatur-Café Ottakring · Sperrmüll-Tauschbörse · Kaffee und Nachbarschaft |
| `api_client.js` `PRIVATE_EVENT_SEED` | "Moon Ceremony", hosted by "Maria's circle" | "Courtyard Supper", hosted by "Maria's Stiege" |
| `api_client.js` `OFFERS_SEED` | PA speakers ("carried them to fifty dance floors") · "DJ table + mixer" · "Ceremonial cacao (1kg blocks)" · "Garden venue" | PA speakers ("good for a courtyard party or a moving-in bash") · "Folding table + hand truck" · "Cordless drill + bit set" · "Shared courtyard (up to 40)" |
| `api_client.js` ring/people `ctx` fields (×7) | "Biodanza — Casa Luna", "Ecstatic Dance Palermo", "Contact Improv Jam" | Tied to the renamed events above |
| `api_client.js` threads.lucia | "Bringing the speakers Sunday — can you carry the stands?" / "Claro! See you at the park 🌞" | Em dash removed; "the park" → "Yppenplatz" |
| `api_client.js` `seed()` (RES-6 activity) | "wants his web to know about your **cacao**…Shared ✓ — your cacao now reaches…" | "…your **drill**…Shared ✓. Your drill now reaches…" |
| `you.js` | "Ceremonial cacao (1kg blocks)" | "Cordless drill + bit set" |
| `discover.js` guest pitch | "This is the public floor" | "These are the public listings" |
| `discover.js` guest Offers pitch | "Speakers, DJ tables, cacao, venues — shared…" | "Speakers, tools, a drill, a courtyard: shared…" (em dash removed) |
| `onboarding.js` name-step heading | "What do people call you on the floor?" | "What do people call you?" |
| `onboarding.js` guest coach | "Browsing as a guest — the public floor only" | "Browsing as a guest. Public listings only" |
| `meet.js` permission row | "Ecstatic-dance context only — widen later if you choose" | "This meeting's context only. Widen later if you choose" |
| `meet.js` offline note | "The floor doesn't need wifi." | "Meeting in person doesn't need wifi." |
| `meet.js` celebration/coach copy | "…Their circle's Moon Ceremony just opened…" / "'Contact' doesn't open the Moon Ceremony — levels have teeth" | "…Their building's Courtyard Supper just opened…" / "'Contact' doesn't open the Courtyard Supper. Levels have teeth" |
| `web.js` person-card copy | "how to reach them, where they dance, what they offer" | "how to reach them, what they're into, what they offer" |
| `web.js` sample tag chips (×2 spots) | `#ecstatic #dj #facilitator` / `#ecstatic` | `#neighbour #fixer #childcare` / `#neighbour` |
| `host.js` reach line | "Anyone in **Buenos Aires** can find this." | "Anyone in **Vienna** can find this." (this app's own Discover screen already says "Vienna ▾" — was inconsistent even before this pass) |
| `host.js` form defaults | Name "Sunset Rooftop Dance", Where "Roof of Casa Verde — shared on arrival" | Name "Courtyard BBQ", Where "Shared courtyard, details on arrival" |

Left alone deliberately: internal code comments that use "floor" as an
existing piece of this codebase's own jargon for "the app's fixture
baseline" (`connect_flow.js`, `guest_chat.js`) — not dance-related, not
user-facing, predates this task. The twelve-word recovery-verse word list in
`onboarding.js` (`fern, tambor, … danza`) — decorative mnemonic words behind
an "Advanced" path nobody hits by default, not named anywhere in the
handover or flagged as the bug. `api_client_live.js`/`live_render.test.js`'s
`"Rooftop Dance"` / `"Sunset Dance"` test-local live-mode payloads — those
are test fixtures for the live-data code path, not app copy.

## The honorary mention

Added a `<details>` block to the Settings screen (the existing "Read the
source" verse card was the natural place — no new surface needed):

> **Where this app’s voice came from** *(collapsed by default)*
> This app first opened with “Step onto the floor,” written for the dancers
> at ecstatic.world, who were the first to ask their own web for floor
> space, a ride, a sound system to borrow. That way of asking a room for
> what you need, honestly and person to person, is where this frame grew
> from. Thank you, ecstatic.world.

No em dash, no apology, names what the framing gave rather than listing what
changed. Verified it parses and renders correctly via a jsdom smoke check
(not added as a formal test — it's static markup, nothing to wire up).

## Follow-up after a second review pass

Three corrections made after re-reviewing the change against the real app
(not just the tests):

- **The welcome heading was still wrong.** Flipping the default to `housing`
  meant `applyOnboardingHeading` fell through to `housingProfile.heading`,
  which is `"Wer hat ein Dach frei? / Who has a roof to share?"` — a
  bilingual, couch-surfing-specific sentence written for device-ui/apps/web
  (which have a language toggle). mobile-ui has no toggle and its Discover
  screen now shows a drill, a hand truck and a Reparatur-Café, not just
  rooms. Added `housingProfile.mobile.onboardingHeading = "Ask the people
  you actually know."` — English-only, matches the resource-sharing register,
  doesn't touch `housingProfile.heading` itself (still pinned by
  `profiles.test.ts`'s `/Dach/`/`/roof/i` checks for the profiles that use it
  directly). Re-pinned `onboarding.test.js` (×2) and `skin.test.js` to the
  new `mobile.onboardingHeading` field instead of `heading`, and added a
  `profiles.test.ts` assertion that the two stay distinct.
- **Straight vs curly punctuation**, three spots in the new copy, to match
  the file's existing convention elsewhere (`phone’s secure storage`,
  `“Contact” doesn’t open…`): the honorary-mention block (straight `'s` and
  `"…"` → curly `’s` and `“…”`), `web.js` (straight `they're` → curly
  `they’re`), `api_client.js` (straight `what's` → curly `what’s`).
- **Ran `npx vite build`** (not just `tsc`/`vitest`) since `index.html` was
  edited directly and jsdom parses more forgivingly than a real build. Built
  clean — the `<details>` insertion is well-formed.

## Verified, not fixed: a guest can already act on real offers under the new default

Flagging this rather than silently fixing it, since it's a behavior change
outside what the handover asked for and touches `discover.js`'s guest-gating
logic, not copy.

`housingProfile.mobile.discoverDefault` is `"offers"` (pre-existing, not
changed by this task). Under the old `ecstatic` default (no
`discoverDefault` override), a bare load landed a guest on the Gatherings
tab, where `renderList()` shows the "join to see more" pitch (DIS-5) and
nothing is actionable. Under the new `housing` default, a bare load lands a
guest directly on the Offers tab instead — and `renderOffers()` /
`offerSheet()` in `discover.js` never check `state.guest` at all. I verified
this directly (harness: `mount()` → `applySkin(getProfile("housing"))` →
`onb("welcome")` → `guestMode()`): the guest sees all three real offers
(PA speakers, folding table + hand truck, drill) immediately, and clicking
one opens a sheet with a live "Ask to borrow" button (`ctx.api.requestBorrow()`),
with no join-first gate anywhere in that path. The
DIS-5 pitch still exists and still works, but a guest has to click back to
"Gatherings" to see it; it's no longer what they see first.

This gap already existed for anyone who explicitly loaded `?app=housing`
before this change — this task didn't introduce the missing guest check, it
just made the profile that has it the one most people hit by default. Left
it alone rather than changing `discover.js`'s request-gating behavior as a
side effect of a copy task; flagging here so it can be triaged
(add a `state.guest` check to `renderOffers`/`offerSheet`, or reconsider
`discoverDefault` for guests specifically) as its own piece of work.

## Tests / typecheck

Building `packages/protocol`, `packages/transport`, `packages/agent-daemon`,
`packages/browser-agent` and `packages/app-profiles` was required first (this
worktree had no `dist/` yet after `pnpm install`).

- `apps/mobile-ui`: `npx vitest run` → **75/75 passed**. `npx tsc --noEmit`
  → clean. `npx vite build` → clean (162 modules, no parse errors — checked
  because `index.html` was hand-edited directly).
- `packages/app-profiles`: `npx vitest run` → **16/16 passed** (extended the
  existing housing mobile-skin test with two new assertions for
  `onboardingHeading`, rather than a new `it()`). `npx tsc --noEmit -p
  tsconfig.json` → clean.
- No lint tooling is configured for either package (no eslint config in the
  repo, no `lint` script on either package) — nothing to run there.
- `packages/ew-contract`'s typecheck failure (missing vitest module) is
  pre-existing per c1be3ff's own report and untouched by this change.

Test files updated to match (pinned strings re-pinned to the new content,
not deleted): `runtime_config.test.js` (×2), `skin.test.js` (renamed the
"ecstatic (no-op)" describe block, since it's no longer a no-op — kept its
still-correct assertions and added the new-mechanism comment),
`onboarding.test.js` (×2, now explicitly calls `applySkin(getProfile
("housing"))` before rendering onboarding, matching what `main.js` really
does at boot — `mount()` in the shared test harness doesn't call
`applySkin`, so this was masking the true default before), `meet.test.js`
(×5: the "Moon Ceremony" → "Courtyard Supper" renames, and two literal
`"ecstatic"` args to `buildConnectUrl` that were comparing against the app's
*actual* rendered connect-link, which now uses the real default `"housing"`
— `connect_url.test.js`'s own `"ecstatic"` args were left alone since those
are just an arbitrary sample id for testing the URL-builder in isolation),
`discover.test.js`, `chat.test.js`, `host.test.js`, `live_render.test.js`
(×3, including re-pinning the two negative "must not leak fixture content"
assertions to the new event/private-event names so they keep testing
something).

`packages/app-profiles/src/profiles.test.ts`: replaced the test asserting
"ecstatic has no `mobile` overrides" (no longer true, and shouldn't be —
`housing` being the shipped default now means ecstatic needs its own
overrides to keep its own wording) with one asserting the new
`onboardingHeading`/`offerChips` values.
