/**
 * Demo 20's one query: "a place to stay in Vienna, when we're not there."
 *
 * Deliberately NOT run through match/lexical.ts's `matchTemplate()` -- that
 * matcher scores chat messages, and this corpus is not a chat: it is one
 * flat and one private calendar (data/geologengasse.ts). Per the handover:
 * "Add a query template for a place to stay; do not fork the matcher" --
 * read as "do not change matchTemplate() to also understand calendars",
 * which this file honours by staying a second, separate, much smaller
 * function that produces the exact same `MatchResult` shape gate.ts already
 * knows how to gate on. gate.ts, decide(), interpret(), the wire envelopes
 * and the k-threshold plumbing are all reused completely unmodified.
 *
 * THE ADDRESS, AND WHEN IT EXISTS IN MEMORY.
 *
 * `matchAccommodation()` bakes `ADDRESS` into the one hit's `message.text`
 * unconditionally, every time it is called -- exactly like every other
 * template's matcher already puts a chat message's real content into
 * `match.hits` regardless of whether the person will go on to consent.
 * That is what lets gate.ts's byte-identical-envelope machinery work at all
 * (its own module doc: "the JSON work happens regardless of consent").
 * Nothing here is new privacy exposure; `main.ts`'s consent-ceremony screen
 * is what must never render this hit's `message.text` before the owner taps
 * "Ja teilen" -- see main.ts's `runConsentCeremony`, which skips the normal
 * "Zeigen, was geteilt würde" reveal entirely for this one template id.
 */
import type { MatchHit, MatchResult, QueryTemplate } from '../types'
import { ADDRESS, FREE_WINDOW_DE } from '../data/geologengasse'

export const ACCOMMODATION_TEMPLATE_ID = 'wot.vienna.geologengasse.accommodation'

export const ACCOMMODATION_TEMPLATE: QueryTemplate = {
  id: ACCOMMODATION_TEMPLATE_ID,
  version: 1,
  category: 'accommodation',
  title: {
    de: 'Bleibt euch die Wohnung offen?',
    en: 'A place to stay in Vienna',
  },
  question: {
    de: 'Habt ihr gerade oder bald eine Wohnung in Wien frei, wo ich ein paar Nächte bleiben könnte?',
    en: 'Do you have a flat in Vienna free right now or soon, where I could stay a few nights?',
  },
  // Unused: matchAccommodation() below never calls match/lexical.ts's
  // scorer. Kept non-empty and topically honest anyway, purely so this
  // object is never a silently-wrong QueryTemplate if some future code path
  // ever did run it through the generic matcher by mistake.
  matchTerms: ['übernachten', 'wohnung frei', 'platz zum schlafen'],
  boostTerms: [],
  excludeTerms: [],
  minScore: 1,
  // The k-threshold demo-crutch, same as T1_HOUSING's own comment: production
  // default is 7 (see data/templates.ts). Here the corpus is ONE flat and
  // ONE calendar, so k=1 is not optional -- with k>1 nothing could ever
  // match. Said honestly in the UI (main.ts's geoKHonesty string), not
  // pretended to be an anonymity floor.
  kThreshold: 1,
  sensitivity: 'high',
  ttlSeconds: 1_209_600, // 14 days
}

/**
 * Always "matches": this corpus has exactly one fact (the flat's free
 * window), and the query has no date parameter to fail against -- there is
 * nothing here TO mismatch. What varies is only whether the owner consents.
 */
export function matchAccommodation(): MatchResult {
  const hit: MatchHit = {
    threadId: 'geologengasse:calendar',
    threadTitle: 'Kalender',
    messageIndex: 0,
    message: {
      ts: new Date().toISOString(),
      author: 'Jakob',
      text:
        `Ja, wir sind vom ${FREE_WINDOW_DE} nicht da. In dieser Zeit kannst du die Wohnung nutzen: ${ADDRESS}.`,
      system: false,
    },
    score: 1,
    terms: [],
  }
  return { hits: [hit], distinctAuthors: 1, aboveThreshold: true }
}

/** Owner-facing preview text: what the "gefunden" card says BEFORE consent.
 *  Deliberately contains the free window but never `ADDRESS` -- see this
 *  file's module doc and main.ts's `runConsentCeremony`, which renders this
 *  string instead of offering the usual "Zeigen, was geteilt würde" reveal
 *  for this one template. */
export function accommodationPreviewDe(): string {
  return `Die Wohnung ist vom ${FREE_WINDOW_DE} frei. Die genaue Adresse siehst du erst, wenn du zustimmst.`
}
export function accommodationPreviewEn(): string {
  return 'The flat is free from 26 October to 1 November 2026. The exact address only appears once you consent.'
}
