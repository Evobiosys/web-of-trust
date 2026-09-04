/**
 * Demo 21 (secondHop scenario): the fixed seed for the two stories this demo
 * tells (owner's own framing, "scenario B" and "scenario A" -- both must run
 * on the SAME three-device chain, Jakob/A/B, since a live show cannot swap
 * casts mid-demo):
 *
 *  - SCENARIO B, the ladder: the SAME story `verification/alpha-run.txt` leg
 *    (g) already ran live against real daemons (Bob asks -> Alice relays her
 *    note about Carol's ladder -> two-hop consent -> Bob connected to
 *    Carol). Re-using it here, rather than inventing a new one, means this
 *    demo is re-enacting something already proven to work at the protocol
 *    layer, not demonstrating a new story for the first time.
 *
 *  - SCENARIO A, the flat: Jakob's OWN real accommodation query, exactly as
 *    demo 20 (geologengasse scenario) already has it -- reused directly
 *    from match/accommodation.ts and data/geologengasse.ts (ACCOMMODATION_TEMPLATE,
 *    matchAccommodation(), ADDRESS/FREE_WINDOW_DE), not copied or
 *    re-implemented. This module's own EARLIER doc comment said this
 *    scenario was deliberately excluded from demo 21 "because that is
 *    demo 20's own, unrelated scenario" -- the owner has since asked for it
 *    here too, specifically so a live three-device chain (Jakob's laptop,
 *    one phone in his own net, a second phone connected only to the first)
 *    can reach the flat two hops out, not just the ladder. See
 *    DECISIONS.md's entry on this (search "scenario A") for the address
 *    discipline that still applies unchanged (VITE_WOT_ADDRESS, never a
 *    literal, never shown before Jakob's own consent) and for the open
 *    question this raises about whether an anonymous second-hop answer is
 *    still the right default when what is being shared is a home address.
 *
 * Three seeds, mounted per role in the three-device chain (see main.ts's
 * seedSecondHopRoot/seedSecondHopGuest):
 *
 *  - Jakob's laptop gets a real inventory entry, the ladder (matched by the
 *    ordinary threadsInScope()/matchTemplate() path every demo already
 *    uses -- no special-casing needed on his side at all), PLUS the
 *    accommodation query's own matcher (match/accommodation.ts), which
 *    needs no seeding at all -- it is a pure function of ADDRESS/FREE_FROM/
 *    FREE_TO, always available once those are set.
 *  - The first hop (A) gets TWO SecondBrainNotes (state.ts) -- her own
 *    private "I know Jakob has this" for EACH story, never Jakob's own
 *    words, never entered by Jakob. Two separate notes, not one note
 *    mentioning both facts, because a real person's private knowledge about
 *    someone else does not usually arrive as a single fused sentence, and
 *    because keeping them separate means either one can independently miss
 *    the anonymity floor or the lexical match without silently breaking the
 *    other.
 */

export const JAKOB_LADDER_INVENTORY_TEXT = 'Hab eine 3-Meter-Leiter im Keller, kannst sie dir gern ausborgen.'

export const A_NOTE_ABOUT_JAKOB_TEXT = 'Der Jakob hat eine Leiter, hab ich mal bei ihm gesehen.'

/** SCENARIO A's own note (see this module's doc comment): A does not know
 *  the flat's address or its free window -- only that Jakob sometimes has
 *  the place free when he travels. Deliberately vague, unlike
 *  `A_NOTE_ABOUT_JAKOB_TEXT`'s ladder note, which IS the fact itself --
 *  this note only needs to clear match/accommodation.ts's own template
 *  terms ('übernachten', 'wohnung frei'), not repeat the calendar/address
 *  Jakob alone holds. */
export const A_NOTE_ABOUT_JAKOB_FLAT_TEXT =
  'Wenn der Jakob verreist, ist bei ihm ab und zu die Wohnung frei, falls jemand kurz übernachten will.'

/** What B is invited to type -- matches both ladder texts above via the
 *  ordinary free-text matcher (kThreshold 1, data/free_text_query.ts), same
 *  as the "Ski" story in test/e2e/call_into_the_web.mjs. Scenario A's own
 *  ask is a FIXED template pick (ACCOMMODATION_TEMPLATE), not free text --
 *  see templatesForScenario() in main.ts. */
export const B_ASK_EXAMPLE_DE = 'Hat wer eine Leiter, die ich mir ausborgen könnte?'
export const B_ASK_EXAMPLE_EN = 'Does anyone have a ladder I could borrow?'
