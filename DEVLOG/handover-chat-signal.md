# Handover — the chat window: Signal-shaped, and it carries what was shared

Worktree: `git worktree add ../wt-chat -b feat/chat-signal`. Work in
`apps/demo/`. Another stream is editing `main.ts` at the same time, so keep
edits there tight and prefer new modules. Commit locally.

## What the owner asked for

Four things, from a real run he just did:

1. **After answering a query, the chat should open again.** Right now the
   answering device lands on an "Antwort gesendet" screen with a Fertig
   button and stops there. He wants to land in the conversation, because the
   next thing he actually does is tell the person the exact house number.
2. **What was shared must appear in the chat.** After sharing the flat, the
   conversation should show something like "Wohnung geteilt" with the shared
   content, on both sides. His words: *"the default message that was shared
   should also appear there"* and *"it should say 'wohnung shared'"*.
3. **A small info button in the chat** explaining how the chat is secured.
   Not a wall of text on the screen: a button that opens the explanation.
   The honest content is already written in `i18n.ts` (the relay honesty
   strings) -- reuse it rather than writing a new, looser claim. It must say
   what the relay can and cannot see, and that the pairing itself is not
   mutually authenticated.
4. **Make it look like a real messenger.** His words: *"make the chat window
   look like signal only with a teal-petrol color if this is not an option on
   signal, otherwise make it in another green color or failing that in a
   purple color"*.

## On the look

Signal's *layout*, not Signal's branding: alternating left/right bubbles,
mine right-aligned and tinted, theirs left-aligned and neutral, tight
vertical rhythm, timestamps small and inside or under the bubble, the
composer pinned at the bottom with the send action beside the field rather
than as a full-width button below it. Look at the current screen first
(`screenLink` in `main.ts`, `.quote` in `app.css`): today it is a stack of
quote blocks with a full-width Senden button, which is why it does not read
as a conversation.

**Colour: teal-petrol.** That is the first choice and it is available, so use
it. Do not copy Signal's blue. Derive a token set that works in BOTH light
and dark, since this app follows the system theme, and keep contrast legible
(the existing `--accent` green is the reference for how strong a tint may be).

Do not import a UI library. Plain CSS, matching the file's existing style.

## Where things are

- `screenLink()` in `src/main.ts` is the chat screen, `chatLog` is its state.
- `ChatEnvelope` in `src/types.ts`, parsed in `src/wire.ts`.
- The answer-sending path is `screenAnswer` / the "Antwort gesendet" screen;
  find it by its i18n key rather than by guessing.
- The shared payload is a `SharedPayload` (`src/types.ts`).

For item 2, do NOT invent a second transport: when a share happens, append a
local chat entry on the sharing side and let the existing answer that already
crosses the wire carry it on the receiving side. The receiving side already
gets the shared content -- render it into the conversation as well as on the
result screen.

⚠️ Do not weaken anything: the consent gate decides what is shared, and a
declined or below-k answer must still produce the byte-identical "no answer".
Nothing about the chat may leak what the gate withheld. If your change makes
the chat reveal that something existed, stop.

## Constraints

- Demos 1, 2, 3, 6 must keep working. `seven_steps.mjs` against a demo-1
  build is the regression check. Demo 20 is the one being demonstrated.
- German first, plain register, no em dashes.
- `npx tsc --noEmit` and `npx vitest run` must pass.

## Report

`DEVLOG/result-report-chat-signal.md`: what changed, the colour tokens you
chose and how they behave in light and dark, and confirmation that the gate
was not weakened.
