# Result report — Marlene's profile and her own written inventory

Branch: `feat/marlene-profile`. All work in `apps/demo/`, as instructed.

## What landed

### Task 1 — Profile
- `Profile` type in `src/types.ts` (displayName, bio, neighbourhood, languages),
  added to `DeviceState`.
- New screen "Mein Profil" (`src/screens/profile.ts`, thin wrapper
  `screenProfile()` in `main.ts`), reachable from home. All four fields are
  written to be editable in place, same no-draft-state pattern as the
  existing chats screen. Editing the display name also updates `me.displayName` (topbar and
  connect ceremony both read `me`; two names on screen at once would look
  like a bug mid-demo) and triggers a rerender; the other three fields save
  without a full rerender, to avoid any risk to in-progress field focus.
- Seeded German profiles for both personas in `state.ts`'s `PERSONAS` (Marlene:
  Ottakring holder blurb; Nora: newcomer seeker blurb).
- Privacy: `gate.ts`'s `GateInput` has no `profile` field. Nothing in this
  build reads `s.profile` anywhere near `decide()`/envelope construction —
  there is no path from the profile screen to a requester, consented or not.

### Task 2 — Her own inventory ("Was ich habe")
- `InventoryItem` type (id, text, createdAt, included), added to
  `DeviceState.inventory`.
- New screen `src/screens/inventory.ts` (add, toggle include/exclude,
  remove), same visual language as `threadRow` in `main.ts` (`.thread`/`.sw`
  classes, in-place label update on toggle).
- **Matching**: `state.ts`'s `threadsInScope()` — the ONE function
  `runConsentCeremony()` in `main.ts` calls before `matchTemplate()` — now
  returns `[...s.threads, ...inventoryThreads(s)].filter(included)`.
  `inventoryThreads()` turns each entry into a synthetic single-message
  `ChatThread` (author = her own display name, `source: 'self'`). This is
  the entire integration: `match/lexical.ts` was not touched, there is no
  second scoring path. **`main.ts`'s call site
  `matchTemplate(tpl, threadsInScope(s))` was not touched either.**
- k-anonymity: an inventory entry always contributes exactly one distinct
  author (herself), same as if she'd posted it in a group chat. It cannot
  clear a k-threshold on its own; combined with chat hits from other people
  it counts toward the floor like anyone else's message. Not exempted
  anywhere.
- Default `included: true` on a new entry (opposite of a 1-on-1 chat's
  default), commented at both definition sites (`InventoryItem.included` in
  `types.ts`, `addInventoryItem()` in `state.ts`).
- Seeded three entries for Marlene, Ottakring/Viennese register, none for
  Nora (she's the seeker). One of the three is deliberately phrased to fire
  the shipped T1 template (`wot.vienna.housing.flat_pre_listing`,
  `matchTerm: 'wohnung frei'`, demo `kThreshold: 1`) — this is the
  demo-critical "type a line, see it found" beat, and it's pinned by a test
  against the real production template, not a stand-in. The add-entry
  input's placeholder is phrased the same way, so a line typed live in
  Vienna is a known-good one.

### Legacy state
`loadState()` now normalizes a record saved by an earlier build (no
`inventory`/`profile` on disk) via `withDefaults()`, in one place, rather
than every reader defending itself. Without this, `screenHome()`'s
`s.inventory.length` or `threadsInScope()`'s `s.inventory.map` would throw
on any phone that already ran the pre-this-change build — the second one
mid-consent-ceremony, not caught by `bootFailed()`.

## Tests

- `test/inventory_match.test.ts` (6 tests): entry matches a template like a
  chat message; excluded entry is unmatchable and re-including it restores
  matchability (both directions, mirroring the existing 1-on-1 opt-out
  test); new entry defaults to included; the seeded T1-matching entry fires
  the real `TEMPLATES` array, not a local stub; the add-entry **placeholder**
  text (the operator's live-demo script, separate copy from the seed) also
  fires T1, so a future copy-edit to either one alone cannot silently kill
  the "type it, then find it" beat; one person's chat message + inventory
  entry count as one distinct author, not two.
- `test/state_defaults.test.ts` (1 test): a legacy on-disk record (written
  directly via `kvSet`, bypassing `loadState()`'s own cache so the
  normalization path is actually exercised) comes back with empty
  `inventory`/`profile` and survives `threadsInScope()`.
- `test/gate_profile_privacy.test.ts` (4 tests): a profile sentinel never
  appears in `threadsInScope()`'s output even when an inventory entry does
  (corpus-level leak check, not just an envelope-level one); `GateInput`
  rejects a `profile` field at compile time (`@ts-expect-error` + excess-
  property check — fails loudly if `GateInput` is ever widened); a shared
  payload has exactly the documented `WirePayload` keys, nothing extra;
  below-k with ONLY an inventory hit is byte-identical to the canonical
  "nothing" envelope (same qid, same forced IV, mirroring
  `gate_identity.test.ts`'s own byte-identity idiom).

## Test counts

- Before: 199 tests (11 files), all green.
- After: 210 tests (14 files), all green. `npx tsc --noEmit -p tsconfig.json`
  clean. `npx vite build` succeeds.
- No existing test was edited.

**What this does NOT cover**: the two new screens (`src/screens/profile.ts`,
`src/screens/inventory.ts`) are type-checked and bundled but never rendered
or clicked — there is no DOM/browser test in this suite (matches the
project's existing test style; every test here runs in plain Node). The 210
tests pin the invariants (matching, k-anonymity, consent), not the UI. Before
the Vienna demo, smoke-test on an actual phone: (a) add an entry on "Was ich
habe" and confirm it appears included by default, (b) toggle it off and back
on, (c) remove it, (d) edit the display name on "Mein Profil" and confirm
the topbar picks it up.

## Exact `main.ts` lines touched (for the merge)

- Two new imports (`renderProfile`, `renderInventory`).
- `Screen` union: added `'profile' | 'inventory'`.
- `render()`'s switch: two new cases.
- `seedPersona()`: one new `const persona = PERSONAS.find(...)` line, and
  the final `state = {...}` literal gained `profile`/`inventory` (built just
  above it from `persona.profile`/`persona.inventorySeed`, deep-copied).
- `screenHome()`: two new nav buttons (inventory count, profile).
- Two new thin wrapper functions, `screenProfile()`/`screenInventory()`,
  inserted between `onImport()` and the connect-screen section — each is a
  few lines that build the body via the new screens module and call the
  existing `shell()`.

**Merge note**: if the other stream touches the line
`if (tpl) match = prune(matchTemplate(tpl, threadsInScope(s)))` inside
`runConsentCeremony()`, inventory must stay flowing through that same
`threadsInScope(s)` argument — that's the one place a merge could silently
drop inventory out of matching.

## Left open

- Profile fields are not surfaced in any answer in this build (out of
  scope per the handover: "if you surface any profile field..."). If a
  future pass wants to offer e.g. "share my Grätzl" alongside a match, it
  must go through `gate.ts`'s existing consent step, not around it — see
  the doc comment on `Profile` in `types.ts` and
  `test/gate_profile_privacy.test.ts`, which pin the current (empty) state
  of that path shut.
- No inline text-edit for an existing inventory entry (add / toggle /
  remove only). Not asked for; editing text is remove-and-re-add for now.
- `pnpm-lock.yaml` was NOT committed. This worktree had no `node_modules`
  at all when I started; running `pnpm install --filter @ew/demo...` to
  get `tsc`/`vitest` working also regenerated an unrelated, pre-existing
  lockfile drift in `apps/mobile-ui` (a dependency listed under
  `devDependencies` that should be under `dependencies`). Since the
  handover scopes this work to `apps/demo/`, I reverted that lockfile
  change rather than fold in an unrelated fix. Whoever merges this will
  need to run `pnpm install --filter @ew/demo...` (or a full `pnpm
  install`) before `tsc`/`vitest` will run here, and will see the same
  lockfile diff regenerate — that's expected, not something this branch
  introduced.
