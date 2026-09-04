# Result report — three modes at onboarding

Worktree `wt-modes`, branch `feat/three-modes`. Built in `apps/demo/`.

## What was built

Three onboarding postures (`Mode = 'sicher' | 'standard' | 'pro'`, `apps/demo/src/state.ts`),
chosen on a radio-card picker (`apps/demo/src/screens/mode_picker.ts`) inlined into every
onboarding screen so picking a mode costs no extra tap beyond what was already there:

- `screenStart()` (demos 1/2/3/6, the persona picker) — inline, above the persona cards.
- `screenGeoNameEntry()` (demo 20's guest) — inline, on the name-entry screen.
- `screenSecondHopNameEntry()` (demo 21's guest, A or B) — inline, on the name-entry screen.
- `screenModePick()` (**new**) — demo 20/21's Jakob laptop, which used to auto-seed straight
  to `home` with no screen at all. Boot now defers the seed call
  (`pendingJakobSeedKind`/`finishJakobOnboarding`) until he picks. This is the one place the
  feature adds an actual extra tap ("Los geht's") to a live demo's opening screen — was
  zero-tap, is now one-tap, Standard preselected.
- "Mein Profil" (`screens/profile.ts`) — current mode shown as a heading, changeable any time,
  picking a different mode re-applies its full posture (see below).
- `screenHome()` also shows the current mode as a one-tap link to the profile screen, so it is
  "visible without hunting for it."

Standard is preselected everywhere (I9). A person who touches nothing gets Standard.

`state.ts` gained `Mode`, `deviceMode(s)` (absent reads as `'standard'`), `modeSwitchDefaults(mode)`,
and `applyModePosture(s, mode)` — the **one** place a mode bundle actually gets written, called
only from an explicit pick (onboarding or the profile screen), never from `deviceMode()` or
`withDefaults()`/`loadState()`, so a rehearsal phone's hand-tuned switches are never silently
reset just because `mode` happens to be absent on load.

## The table: what each mode does to every mechanism found

| Mechanism (file) | **Sicher** | **Standard** (default) | **Pro** |
|---|---|---|---|
| Free-text ask, composing (`screenAsk`, `data/free_text_query.ts`) | Card hidden. This device cannot compose a free-text ask. | Shown (today's existing behaviour, unchanged). | Shown. |
| Free-text ask, receiving — ambient delivery (relay/webrtc auto-arrival), manual QR/paste scan, AND demo 21's relay-aware ceremony (`resolveIncomingTemplate`, shared by `handleAmbientQuery`, `runConsentCeremony`, `runSecondHopRelayCeremony`) | **Never resolves, on any of the three entry points.** All three callers resolve a query through this one function, so a Sicher device folds a free-text ask into the exact same "unresolvable template" nothing a corrupt/unknown templateId already gets — regardless of whether it arrived ambiently, was manually scanned/pasted, or came via a relay ceremony, and regardless of who sent it or what mode they picked. | Resolves and matches normally, on every entry point. | Resolves and matches normally. |
| Group chat thread, seed-time default (`seedPersona`'s holder branch) | Starts **excluded**; must be switched on deliberately. | Starts included (existing default, unchanged). | Starts included (unchanged). |
| Seeded/imported inventory, seed-time default (`seedPersona`'s `inventorySeed`, `seedSecondHopRoot`'s ladder item) | Starts **excluded**. | Starts included (unchanged). | Starts included (unchanged). |
| A freshly-imported chat file (`onImport`) | Starts **excluded**, overriding the parser's own group/direct split. | Parser's existing default (group on, direct off). | Same as Standard. |
| A newly-typed **inventory entry** (`addInventoryItem`) | Untouched by all three modes — still starts included. She is typing it in right now, on purpose; that reasoning does not change with posture. | Same. | Same. |
| Own direct answer, timing (`secondHopUniformModeDirect`, D28) | Forced **uniform** (~30 s always) — a refused free-text ask, a genuine no-match and a real "nothing" are all indistinguishable by the clock. | Fast (today's shipped default, unchanged). | Fast (unchanged). |
| Relaying someone else's question, timing (`secondHopRevealRelay`, D30) | Non-revealing (unchanged from Standard — already the conservative posture). | Non-revealing (today's shipped default). | **Revealing** — asker can roughly tell a relay happened, opted in explicitly. |
| Whether a second hop is offered at all (`runSecondHopRelayCeremony`'s `eligibleNotes`) | **Never offered.** Folds into the depth-cap's existing "nothing" path — this device is never put in the position of deciding whether to relay. | Offered normally (existing behaviour). | Offered normally. |
| k-anonymity floor (`kThreshold`, `data/templates.ts`/`free_text_query.ts`) | **Untouched.** | **Untouched.** | **Untouched.** |
| Consent gate / byte-identical "no answer" (`gate.ts`) | **Untouched.** | **Untouched.** | **Untouched.** |

k-threshold and the consent gate are named explicitly as out of scope by the handover's own
constraints, and D27 already found the structural reason raising `kThreshold` wouldn't deliver
real k=7 for this app's single-author inventory/note content anyway — so no mode pretends to
touch it. This is a floor protecting the crowd, not a personal exposure dial.

## The German copy (all three modes)

Onboarding heading: **„Wie möchtest du gefragt werden können?"** — with a note under the picker:
*„Du kannst das später jederzeit unter „Mein Profil" ändern."*

**Sicher** — *Am stärksten geschützt.*
> Du bekommst nur die vorbereiteten Fragen zu sehen, nie eine Frage in freien Worten. Es kann
> dir nicht passieren, dass dir unvorbereitet etwas sehr Persönliches gestellt wird. Eine
> Frage, die über dich an jemand anderen weiterläuft, wird nie weitergegeben. Was du früher
> eingetragen hast, ist erst sichtbar, wenn du es einzeln freigibst. Und egal was du
> antwortest, es dauert bei dir immer gleich lange, damit niemand daraus etwas ablesen kann.

**Standard** *(vorausgewählt)* — *Empfohlen. Fast so geschützt wie Sicher.*
> Du kannst auch in freien Worten gefragt werden, nicht nur mit den vorbereiteten Fragen.
> Deine eigene Antwort geht so schnell wie möglich raus, ehrlich gesagt heißt das: wer fragt,
> kann daraus grob ablesen, wie lange du gebraucht hast. Reichst du eine Frage für jemand
> anderen weiter, bleibt das verborgen, das dauert bei dir immer gleich lange. Eine Frage kann
> einmal an jemanden weitergereicht werden, den du kennst und dem du vertraust.

**Pro** — *Für dich, wenn du genau weißt, was du teilst und wie du sprichst.*
> Du bekommst alles: Fragen in freien Worten, so schnelle Antworten wie möglich, und wenn du
> eine Frage für jemand anderen weiterreichst, kann man das an der Zeit erkennen. Das ist
> keine zusätzliche Sicherheit, das ist bewusst gewählte Geschwindigkeit und Offenheit. Du
> entscheidest selbst, was du teilst und wie du es sagst.

No em dashes anywhere in the copy. All strings live in `apps/demo/src/i18n.ts` with English
translations alongside (same table, `en` column).

## Ways someone can still end up in an awkward position that NONE of the three modes prevent

This is the point of the task, so stated plainly, not softened:

1. **Asked by proxy, and unable to tell.** A mode governs a person only as *relayer*, never as
   *target*. By I8 ("no hop reveals more than a direct request"), a relayed query is
   byte-identical to a direct one on Jakob's own screen. A Sicher-mode Jakob can be put on the
   spot by a stranger's question routed through someone he trusts, and has no way to know it
   happened that way rather than directly.

2. **The asker's own posture doesn't travel with the question.** No `QueryEnvelope` field
   carries mode. "Nothing travels a second hop" is only ever true of *this* device, as relayer.
   A Sicher asker's ordinary fixed-template question can still be relayed onward by whichever
   Standard/Pro intermediary happens to hold a note about someone else — the asker cannot
   enforce her own posture past her own device.

3. **Posture is per device, not per relationship.** Nobody can be Sicher toward one person and
   Standard toward another. `peer.blocked` is the only per-peer lever this app has, and it is
   all-or-nothing (silently drops everything from that peer), not a nuance dial.

4. **Repeat asking is unlimited.** The byte-identical "no answer" protects any single answer
   perfectly. It does nothing about being asked the same uncomfortable thing five times by five
   different paths. The asker learns nothing from repetition; the person being asked still
   accumulates the discomfort of being asked.

5. **I4's own asymmetry is untouched by every mode.** Every query that actually surfaces already
   names the asker and the request text before a decision is made — that is I4, deliberate, and
   no mode changes it. Sicher reduces *how often* something surfaces (no free text, no relay
   offers) but the moment a fixed-template question genuinely matches something in scope, the
   person still sees exactly who is asking and still has to decide yes or no. Sicher removes two
   specific levers; it does not remove the underlying "asked to decide, by someone I know"
   moment the owner is actually worried about.

6. **The loosest posture in the room sets the room's real exposure.** A Standard/Pro person's
   free-text broadcast (`askNetwork()`) still reaches every connected peer who isn't Sicher.
   Sicher protects the Sicher-mode person specifically; it does nothing for anyone else still
   exposed to that same broadcast. The awkwardness is distributed by whoever is least careful
   present, not chosen by whoever is exposed.

7. **Switching to Sicher later does not retroactively hide anything already shared.** Mode only
   sets *default* scope for content seeded or imported from that point on. Anything a person
   already switched to "included" before changing their mode stays included after switching to
   Sicher — `applyModePosture` never touches existing `ChatThread.included`/`InventoryItem.included`
   values, only the mode field and the two timing switches. A person who picks Sicher expecting
   it to re-tighten everything they had previously opened up will be wrong about that. The
   profile screen says this explicitly (`modeChangeScopeNote`, i18n.ts) so it is at least stated
   to the person, not only true in the code and silent on screen.

8. **No enforcement, only local restraint.** A device's mode is self-reported, local-only state,
   never transmitted, never checked by a peer. Nothing stops a compromised or misconfigured
   Standard/Pro device from sending free text to a Sicher peer's connected chain regardless of
   what that peer chose — closed at the *receiving* end (`resolveIncomingTemplate`'s own gate,
   which does hold on every entry point this app has, ambient AND manual scan alike — see the
   table above), never at the sending end of someone else's device.

9. **The mode badge can go stale.** A mode is a starting posture, not a lock (the handover's own
   requirement) — every switch it sets stays individually re-toggleable afterward. So a person
   can pick Sicher, then individually uncheck the uniform-timing switch on A's own home screen
   (still shown, still independently settable), and continue to see "Aktueller Modus: Sicher"
   everywhere while one of the things Sicher promised is no longer actually true of this device.
   This is the direct, deliberate cost of "every individual switch stays individually settable" —
   not a bug, but a concrete way the UI can tell a person their exposure is tighter than it is.

## Regression evidence

- `apps/demo`: `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx vitest run` — **315/315 tests pass**, unchanged count (no existing test needed changing;
  `mode` is optional so every existing `DeviceState` literal across the suite still compiles).
- `vite build` succeeds for demo 1 (default), demo 2 (relay), demo 3 (webrtc), demo 6 (ladder),
  demo 20 (geologengasse) and demo 21 (secondHop) build configurations.
- `test/e2e/seven_steps.mjs` against a fresh demo-1 build: **23/23 PASS**, including a second
  full run after the `render()` fix below — both runs clean, no page errors.
- Manual Playwright smoke of demo 20 and demo 21 (no live relay available locally, so the
  connect-link ceremony itself does not fully complete end to end — the same pre-existing,
  already-disclosed local-testing gap D22/D25 note for this architecture, not new here):
  Jakob's laptop now shows `screenModePick` (Sicher/Standard/Pro cards, Standard preselected,
  "Los geht's"), lands on `home` with `Aktueller Modus: Standard` visible; the demo 20 guest
  name-entry screen renders the picker inline and completing it with Sicher picked shows
  `Aktueller Modus: Sicher` on her home screen with the free-text ask card absent from
  `screenAsk`; picking Sicher for Jakob's own demo 21 laptop leaves his ladder inventory entry
  `ausgeschlossen` (excluded) rather than the Standard/Pro default of included; changing mode
  from "Mein Profil" (Standard → Pro) updates the heading and the home-screen badge immediately.
- No stray dev/preview servers left running (`lsof -nP -iTCP -sTCP:LISTEN` checked and clear).

## A bug found and fixed while wiring this in

`render()`'s `if (!state) return void screenStart()` guard ran **before** the `screen` switch,
unconditionally — so `screen = 'modePick'` (set in `boot()` for Jakob's laptop) was silently
never reached; every render fell straight through to `screenStart()`, which for a geologengasse
build calls `screenGeoNameEntry()` regardless. Fixed by checking `pendingJakobSeedKind` in that
same early guard, before the `screen` switch is ever consulted. Caught by manually driving the
demo 20 build rather than by any existing test — none of the 315 unit tests or `seven_steps.mjs`
exercise the state-less-boot path this touches, which is itself worth flagging: this repo has no
automated coverage of demo 20/21's Jakob-laptop bootstrap screen at all, in either the old
zero-tap or the new one-tap shape.

## Files touched

- `apps/demo/src/state.ts` — `Mode` type, `deviceMode()`, `modeSwitchDefaults()`,
  `applyModePosture()`, `DeviceState.mode?`.
- `apps/demo/src/screens/mode_picker.ts` (**new**) — shared picker component + `modeTitleKey()`.
- `apps/demo/src/screens/profile.ts` — mode section (current mode heading + picker).
- `apps/demo/src/main.ts` — inline pickers on `screenStart`/`screenGeoNameEntry`/
  `screenSecondHopNameEntry`; new `screenModePick`/`finishJakobOnboarding`; `boot()` defers
  Jakob's laptop seed; `render()` fix; `resolveIncomingTemplate` Sicher gate;
  `runSecondHopRelayCeremony`'s `eligibleNotes` Sicher gate; `screenAsk` free-text card gate;
  `screenHome` mode badge; seed-time `included` overrides in `seedPersona`/`seedSecondHopRoot`/
  `onImport`; honest fallback text (`UNRESOLVED_TEMPLATE.question`) instead of a raw template id
  on the two manual-scan "checking" screens, since Sicher can now be the reason `tpl` is
  undefined there.
- `apps/demo/src/i18n.ts` — all mode copy, `de`/`en`, including `modeChangeScopeNote` (profile
  screen only — see gap 7).
- `DECISIONS.md` — D31, the append-only record for everything in this report.
