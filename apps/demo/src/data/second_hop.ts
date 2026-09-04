/**
 * Demo 21 (secondHop scenario): the fixed seed for the one story this demo
 * tells -- the SAME story `verification/alpha-run.txt` leg (g) already ran
 * live against real daemons (Bob asks -> Alice relays her note about Carol's
 * ladder -> two-hop consent -> Bob connected to Carol). Re-using it here,
 * rather than inventing a new one, means this demo is re-enacting something
 * already proven to work at the protocol layer, not demonstrating a new
 * story for the first time.
 *
 * Two seeds, each mounted on exactly one role in the three-device chain (see
 * main.ts's seedJakob/seedSecondHopFirstHop/seedSecondHopGuest):
 *
 *  - Jakob's laptop gets a real inventory entry (matched by the ordinary
 *    threadsInScope()/matchTemplate() path every demo already uses -- no
 *    special-casing needed on his side at all).
 *  - The first hop (A) gets a SecondBrainNote (state.ts) -- her own private
 *    "I know Jakob has this," never Jakob's own words, never entered by
 *    Jakob.
 *
 * Deliberately NOT the accommodation/flat-sharing story (data/geologengasse.ts):
 * that is Jakob's real situation and demo 20's own, unrelated scenario. This
 * is a plain, low-stakes object precisely so nothing about it competes with
 * or overstates demo 20's real content.
 */

export const JAKOB_LADDER_INVENTORY_TEXT = 'Hab eine 3-Meter-Leiter im Keller, kannst sie dir gern ausborgen.'

export const A_NOTE_ABOUT_JAKOB_TEXT = 'Der Jakob hat eine Leiter, hab ich mal bei ihm gesehen.'

/** What B is invited to type -- matches both texts above via the ordinary
 *  free-text matcher (kThreshold 1, data/free_text_query.ts), same as the
 *  "Ski" story in test/e2e/call_into_the_web.mjs. */
export const B_ASK_EXAMPLE_DE = 'Hat wer eine Leiter, die ich mir ausborgen könnte?'
export const B_ASK_EXAMPLE_EN = 'Does anyone have a ladder I could borrow?'
