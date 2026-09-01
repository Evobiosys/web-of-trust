/**
 * German compound-word splitting.
 *
 * German freely concatenates nouns ("Wohnungssuche", "Gemeindebauwohnung"),
 * usually joined by a linking morpheme (Fugenelement: -s-, -es-, -n-, -en-,
 * -er-, -e-, or nothing at all). A message that says "Wohnungssuche" must
 * still match a template term of "wohnung", or recall on this demo's whole
 * housing category collapses.
 *
 * This is a dictionary-driven LONGEST-MATCH splitter: given a curated list
 * of head words mined from the vocabulary clusters in
 * overnight/05-chat-group-information.md section 2, it tries to decompose
 * the WHOLE input string into a sequence of dictionary words, each
 * optionally preceded by a linking morpheme, each at least 4 letters long
 * (the length floor exists specifically to keep nonsense 2-3 letter
 * fragments from ever counting as a "part").
 *
 * Design choice -- whole-string decomposition, not "does it contain a
 * substring": a word only counts as a compound if the split accounts for
 * every letter. This is what makes the "must NOT split" cases in
 * test/match_compound.test.ts correctly fail: "Wohnungsamt" contains
 * "wohnung" as a prefix, but the 3-letter remainder "amt" is below the
 * length floor and there is no dictionary word it could be, so the whole
 * decomposition fails and splitCompound returns []. That is intentional: a
 * function that greedily returned ["wohnung"] and silently dropped the
 * undecomposed remainder would be indistinguishable from a real hit on
 * "wohnung" alone, and undercut the length-floor guarantee entirely.
 *
 * Division of labour with stem.ts: "-in"/"-erin" (Nachmieterin, Elektrikerin)
 * is a DERIVATIONAL suffix (word formation), not a Fugenelement (a
 * compounding joint) -- German doesn't insert "-in" between two nouns, it
 * appends it to turn an agent noun feminine. So this module deliberately
 * does NOT treat "in" as a linker, and "Nachmieterin" does NOT decompose
 * here. It matches "Nachmieter" instead via stem.ts's step-1 erin/erinnen
 * rule (both stem to "nachmiet"). See test/match_compound.test.ts for the
 * "must NOT split" assertion that pins this division down.
 */

// Fugenelemente (linking morphemes), longest first so a longer valid linker
// is preferred over a shorter one that happens to be a prefix of it
// ("es" before "e" before ""). "" means "no linker, words are simply
// concatenated" (e.g. "Kindergartenplatz" = kindergarten + platz, no joint).
const LINKERS = ['es', 'en', 'er', 's', 'n', 'e', '']

const MIN_PART_LEN = 4

/**
 * Head-word dictionary, curated from the Vienna housing / health / trades /
 * childcare vocabulary clusters in overnight/05-chat-group-information.md
 * section 2. Kept in the same folded (umlaut-free) form normalize()
 * produces, since splitCompound operates on already-normalized tokens.
 */
export const HEAD_WORDS: readonly string[] = [
  // Housing / flats (2.1, 2.2, 2.4) -- kept ATOMIC (roots only, not
  // pre-combined) so splitCompound actually has to do the decomposing, e.g.
  // "Hausverwaltung" -> [haus, verwaltung], not a single precooked entry.
  'wohnung',
  'wohnungen',
  'suche',
  'nachmieter',
  'vermieter',
  'mieter',
  'miete',
  'untermieter',
  'untermiete',
  'zwischenmieter',
  'zwischenmiete',
  'gemeindebau',
  'gemeinde',
  'genossenschaft',
  'warteliste',
  'liste',
  'anwartschaft',
  'vormerkschein',
  'schein',
  'ticket',
  'schluessel',
  'uebergabe',
  'geheimtipp',
  'tipp',
  'zimmer',
  'bewohner',
  'mitbewohner',
  'meldezettel',
  'verwaltung',
  'verwalter',
  'haus',
  'bezirk',
  'stiege',
  'start',
  // Ablöse (2.3) -- kept for completeness even though T1-T5 don't cover it
  'abloese', // "abloese" is normalize()'s folded form of "Ablöse" (ö -> oe)
  'moebel',
  'handgeld',
  // Health (2.7)
  'arzt',
  'kassenarzt',
  'hausarzt',
  'wahlarzt',
  'ordination',
  'aufnahme',
  'stopp',
  'kassen',
  'stelle',
  'fach',
  'bereitschaft',
  'dienst',
  // Trades (2.8, 2.9)
  'handwerker',
  'installateur',
  'elektriker',
  'fliesenleger',
  'tischler',
  'klempner',
  'empfehlung',
  'wasser',
  'schaden',
  'gewerbe',
  // Childcare (2.6)
  'kindergarten',
  'platz',
  'betreuung',
  'tagesmutter',
  'tagesvater',
  'babysitter',
  'babysitterin',
  'krabbelstube',
  'nachmittag',
  'kinder',
  'hort',
  // Jobs (2.5)
  'nebenjob',
  'quereinstieg',
  'quereinsteiger',
  'werk',
  'vertrag',
  'personal',
  'aushilfe',
  // Bureaucracy (2.13, 2.14)
  'formular',
  'ansprech',
  'partner',
  'wohn',
  'beihilfe',
  // Second-hand / events (2.10, 2.11)
  'flohmarkt',
  'wagen',
  'sperrmuell',
  'termin',
  'abhol',
  'buecherkastl',
  'gaeste',
  'wohnzimmer',
  'konzert',
  // Health/peer-support (2.15)
  'therapie',
  'therapeut',
  'selbsthilfe',
  'gruppe',
  'psychotherapie',
  'krisen',
  // School (2.16)
  'schule',
  'sprengel',
  'ausnahme',
  'antrag',
  'wunsch',
  'wechsel',
  // Parking / Sperrmüll (2.17)
  'park',
  'zone',
  'kurz',
  'pickerl',
  'garage',
] as const

const HEAD_SET: ReadonlySet<string> = new Set(HEAD_WORDS)

/**
 * Try to decompose `word` (case-insensitive) into a sequence of dictionary
 * head words, each >= MIN_PART_LEN letters, optionally joined by a
 * Fugenelement. Returns the ordered list of matched head words on success,
 * or [] if no decomposition accounts for the ENTIRE string.
 */
export function splitCompound(word: string, dict: ReadonlySet<string> = HEAD_SET): string[] {
  const w = word.toLowerCase()
  const memo = new Map<string, string[] | null>()

  function solve(s: string): string[] | null {
    if (s.length === 0) return null // empty remainder is never itself a valid "part"
    if (memo.has(s)) return memo.get(s) as string[] | null

    let result: string[] | null = null
    for (let len = s.length; len >= MIN_PART_LEN; len--) {
      const piece = s.slice(0, len)
      if (!dict.has(piece)) continue
      const rest = s.slice(len)
      if (rest.length === 0) {
        result = [piece]
        break
      }
      for (const linker of LINKERS) {
        if (!rest.startsWith(linker)) continue
        const afterLinker = rest.slice(linker.length)
        if (afterLinker.length === 0) continue // a bare trailing linker is not a word
        const sub = solve(afterLinker)
        if (sub) {
          result = [piece, ...sub]
          break
        }
      }
      if (result) break
    }

    memo.set(s, result)
    return result
  }

  return solve(w) ?? []
}

/** True iff `word` decomposes into 2 or more dictionary parts. */
export function isCompound(word: string, dict: ReadonlySet<string> = HEAD_SET): boolean {
  return splitCompound(word, dict).length >= 2
}
