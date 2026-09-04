# Result report -- the chat window: Signal-shaped, and it carries what was shared

Worktree: `../wt-chat`, branch `feat/chat-signal`. Committed locally, not
pushed to any remote.

## What landed

### 1. Land in the conversation after answering

`sendAnswerOverRelay` / `sendAnswerOverWebrtc` (`apps/demo/src/main.ts`) kept
the exact "Antwort gesendet" confirmation screen -- wording, the "Code
stattdessen zeigen" fallback, demo 20's "nächste Frage" button when more
guests are queued -- and changed only where its **Fertig** button goes:
`go('home')` -> `go('link')`. One tap after sending lands him in the
conversation, where the next thing he actually does is type the house
number.

`screenResult` (the asker's landing screen) got the same treatment: its
**Fertig** button now goes to `link` instead of `home` whenever a live
conversation actually exists (`wotMode() !== 'qr' && peer` -- the same guard
`screenHome`'s own "Jetzt schreiben" button already uses). Demo 1 (qr mode)
is untouched: `canChat` is always false there, so its Fertig button still
goes home, exactly as before.

### 2. What was shared, in the chat, on both sides

No second transport. `emitAnswer` now keeps `decide()`'s `outcome` (it used
to discard everything but `envelope`) and threads it, with `tpl`/`match`,
into `sendAnswerOverRelay`/`sendAnswerOverWebrtc`. A new `pushLocalShare()`
appends a local `chatLog` entry **only when `outcome === 'shared'`, and only
after the network send has already gone out** -- see that function's own
doc comment for why the ordering is load-bearing, not stylistic (below).

On the receiving side, `pushReceivedShare()` turns an already-decoded
`AnswerEnvelope` into a chat-log entry -- called right where `screenResult`
already was, at all three places an answer gets decoded (`scanAnswer`,
`askOverRelay`, `askOverWebrtc`). It renders the same shared items
`screenResult` already showed, now also inside the conversation, styled as a
distinct card: `🏠 Wohnung geteilt` (or the matching label for the other
four templates -- see `screens/chat.ts`'s `CATEGORY_LABEL` map and its doc
comment on why a bare template title doesn't work for one of them).

**Timing note, because this file's gate.ts is the one place in this repo
where timing is the whole point:** `pushLocalShare` is called strictly
*after* `sendAnswerOverRelay`'s `channel.send(...)` (or
`sendAnswerOverWebrtc`'s `channel.send(...)`) has already resolved/thrown --
never inside `emitAnswer`'s outcome-independent dispatch path, and never
before the network call. Building the local item list costs CPU
proportional to `match.hits.length`, same as `gate.ts`'s own
`buildSharedJsonBytes` -- doing that work before the send would have
reopened exactly the side channel `gate.ts`'s "do the JSON work
unconditionally, every time" discipline exists to close. Doing it after is
invisible to the asker: the bytes already left.

### 3. The security info button

`screens/chat.ts`'s `renderSecurityInfo()` is a native `<details>` (no modal
plumbing) opened by a small "ⓘ Wie ist das gesichert?" button next to the
connection-test button. It shows whichever of i18n.ts's two **existing**
honesty strings actually describes this conversation right now --
`webrtcExplain` when the direct data channel is open, `relayExplain`
otherwise, same condition `sendOverActiveTransport` already uses to pick a
transport. Neither string was touched; nothing new was claimed. Two small
new i18n keys were added for the button/card labels only (`chatInfoBtn`,
`chatSharedLabel`) -- plain UI copy, not a security claim.

### 4. The look

New module `apps/demo/src/screens/chat.ts` (mirrors `screens/profile.ts`'s
own pattern: builds DOM only, `main.ts#screenLink` still owns `chatLog`,
`shell()`, and navigation -- kept as its own file specifically so main.ts's
diff for this feature stays as small as the feature allows, per the
handover's note that another stream is editing main.ts at the same time).

- Right-aligned tinted bubbles for mine, left-aligned neutral for theirs
  (`.bubble.mine` / `.bubble.theirs`, `.bubble-row.mine`/`.theirs`), a
  rounded-corner "tail" instead of a triangle, timestamps small under the
  bubble text.
- Composer pinned to the bottom (`position: sticky; bottom: 0`), one field
  and a round send button beside it -- not a full-width button underneath.
- The "what was shared" card is a wider bubble with its own header and one
  block per item, same left/right placement and tint as an ordinary bubble.
- The connection-test button and the info disclosure share a small toolbar
  row above the messages instead of a full-width primary button.

**Colour tokens** -- `app.css`, new pair kept apart from the existing
`--accent`/`--accent-ink` (still green, still used everywhere else: the
outcome banner, the switch, every other `.btn.primary`) so this one screen's
colour choice never bleeds into the rest of the app:

| | dark (default) | light |
|---|---|---|
| `--chat-accent` | `#45c4b8` | `#0e6b63` |
| `--chat-accent-ink` | `#06211e` | `#ffffff` |

Same contrast strategy `--accent` already uses: a lighter, more saturated
tone against the dark background paired with a dark ink; a darker tone
against the light background paired with white ink. Mine-bubbles use a
`color-mix(in srgb, var(--chat-accent) 22%, var(--bg-raised))` tint (same
technique as the existing `.outcome.shared` background, a few points
stronger since a bubble needs to read as filled, not just tinted) rather
than a solid fill, so the ordinary `var(--ink)` text colour stays legible
without a second ink lookup per element. The composer's send button and the
open info disclosure's border use the accent solidly.

## Gate / consent check (⚠️ read this before trusting the rest)

- Nothing in `gate.ts` was touched.
- `decide()`'s plaintext construction, byte-identical-envelope masking, and
  `settleAt` budget are exactly as before -- `emitAnswer`'s transport
  dispatch (the block with the "branching here would reopen exactly the
  side channel gate.ts's byte padding exists to close" comment) still
  branches on nothing but "is there a network address for this peer",
  never on `outcome`.
- The four `nothing` reasons (`no-match`/`below-k`/`declined`/`blocked`)
  still produce byte-identical `AnswerEnvelope`s -- `pushLocalShare` and
  `pushReceivedShare` both gate on `outcome === 'shared'` and touch nothing
  that crosses a wire.
- Nothing about the chat screen can reveal what a `nothing` outcome
  withheld: a declined/below-k/no-match/blocked answer never produces a
  `chatLog` entry on either device, so the conversation simply has one
  fewer message -- indistinguishable from "nobody asked anything yet",
  never a visible "something happened but you can't see it" cue.

## Testing

Testing now.

- `npx tsc --noEmit -p tsconfig.json` -- clean, no errors.
- `npx vitest run` -- **279/279 passed**, all 20 files, including
  `gate_identity.test.ts` and `gate_timing.test.ts` (the tests that pin the
  byte-identity and timing-indistinguishability invariants this feature
  could most plausibly have broken).
- Demo 1 regression, exactly as the handover specifies: built with no
  `VITE_WOT_MODE`/`VITE_WOT_SCENARIO` (qr mode, the default), served via
  `vite` dev server on `:5180`, ran `test/e2e/seven_steps.mjs` against it
  twice (once mid-change, once again against the final diff) --
  **22/22 checks passed** both times, including the byte-identity walk
  (decline vs no-match, below-k vs no-match) and "no uncaught page errors."
  Chat/link screen is unreachable in qr mode at all (`wotMode() !== 'qr'`
  gates its only entry points), so demo 1 never touches any of this code.
- Demo 3 (webrtc mode) build: confirmed via direct inspection of the
  compiled bundle that `VITE_WOT_MODE=webrtc` inlines correctly
  (`function wotMode(){return"webrtc"}`), and drove the real two-scan
  pairing + webrtc offer/accept ceremony through two live Playwright
  browser contexts up to the point the direct data channel negotiates.
  ICE never completed in this sandboxed exec environment (host-only
  candidates failing to connect between two headless Chromium contexts --
  environmental, not something this change touches; demo 3's transport
  code itself is unmodified). Did **not** chase this further given the
  time budget; flagging it rather than silently declaring it covered.
- Because of that gap, the actual answer -> `pushLocalShare` ->
  `sendAnswerOverRelay`/`Webrtc` -> `go('link')` -> `pushReceivedShare` ->
  `screenResult`'s Fertig -> `go('link')` chain was verified by full source
  read-through plus the type checker (every function signature threading
  `outcome`/`tpl`/`match` through checks out end to end) rather than a live
  two-device network walk. This is the one piece of the functional half I'd
  flag as verified-by-reading rather than verified-by-running.
- The look itself (bubbles, shared card, composer, info disclosure, both
  themes) **was** run live: a small standalone Playwright harness imported
  `screens/chat.ts`'s exported renderers directly against real sample data
  (including the exact accommodation-template text, address placeholder and
  all) through the Vite dev server, screenshotted in both `dark` and
  `light` `colorScheme`. Screenshots showed exactly the intended layout --
  right/left alignment, teal-petrol tint in both themes, the "🏠 Wohnung
  geteilt" card, the composer's round send button beside the field, and the
  info disclosure opening to the verbatim `relayExplain` string with no
  layout glitch (fixed one: the toolbar's plain button was stretching to
  match the opened `<details>` panel's height -- `align-items: flex-start`
  on `.chat-toolbar` fixed it). The harness file and all dev/preview
  servers were removed after use; `ps`/`lsof` confirm nothing is left
  listening.
- You can test in parallel without interference -- everything above ran in
  a separate worktree (`../wt-chat`) against ephemeral local ports, nothing
  touched shared state.

## Files

- `apps/demo/src/screens/chat.ts` -- new.
- `apps/demo/src/main.ts` -- imports; `chatLog`'s type and its four push
  sites; `pushLocalShare`/`pushReceivedShare`; `emitAnswer`,
  `sendAnswerOverWebrtc`, `sendAnswerOverRelay` signatures and their Fertig
  buttons; `screenResult`'s Fertig button; `scanAnswer`/`askOverRelay`/
  `askOverWebrtc`'s three decode sites; `screenLink` (rewritten to delegate
  to `screens/chat.ts`); `netBubble`'s `above-composer` class.
- `apps/demo/src/i18n.ts` -- two new keys (`chatInfoBtn`, `chatSharedLabel`).
- `apps/demo/src/app.css` -- `--chat-accent`/`--chat-accent-ink` tokens,
  `.chat-toolbar`/`.chat-info*`, `.chat-log`/`.bubble*`, `.composer*`,
  `.netbubble.above-composer`.
