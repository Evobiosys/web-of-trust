import { describe, expect, it } from 'vitest'
import { stem } from '../src/match/stem'

describe('stem (Snowball German)', () => {
  // --- Pairs given verbatim in the task spec ---------------------------------
  it('wohnung -> wohnung (no suffix in R1 to strip)', () => {
    expect(stem('wohnung')).toBe('wohnung')
  })

  it('wohnungen -> wohnung (step 1 strips -en)', () => {
    expect(stem('wohnungen')).toBe('wohnung')
  })

  it('suche -> such (step 1 strips -e)', () => {
    expect(stem('suche')).toBe('such')
  })

  it('suchen -> such (step 1 strips -en)', () => {
    expect(stem('suchen')).toBe('such')
  })

  it('frei -> frei (word is too short / all-vowel-tail, nothing in R1 to strip)', () => {
    expect(stem('frei')).toBe('frei')
  })

  it('freie -> freie: R1("freie") is the empty region at the end of the word', () => {
    // Divergence from the task's assumed pair (freie -> frei), documented per
    // instructions ("fix your test, not the algorithm"):
    // R1 is defined as "the region after the first non-vowel following a
    // vowel". In "freie" (f-r-e-i-e), the first vowel is 'e' at index 2; every
    // letter after it ('i', 'e') is ALSO a vowel, so there is no non-vowel
    // left to find, and by the algorithm's own end-of-word clause R1 becomes
    // the empty region at position 5 (the end of the word). No suffix can
    // start at or after position 5 on a 5-letter word, so step 1's "-e" rule
    // cannot fire here -- a faithful implementation leaves "freie" untouched.
    // This is a known, well-documented limitation of the German Snowball
    // stemmer on short vowel-heavy adjective forms; it was not special-cased
    // away.
    expect(stem('freie')).toBe('freie')
  })

  it('nachmieter -> nachmiet (step 1 strips -er)', () => {
    expect(stem('nachmieter')).toBe('nachmiet')
  })

  it('nachmieterin -> nachmiet: the feminine agent-noun suffix -erin converges on the same stem as nachmieter (step 1\'s erin rule)', () => {
    expect(stem('nachmieterin')).toBe('nachmiet')
  })

  it('mieten -> miet (step 1 strips -en)', () => {
    expect(stem('mieten')).toBe('miet')
  })

  it('vermieten -> vermiet (step 1 strips -en)', () => {
    expect(stem('vermieten')).toBe('vermiet')
  })

  it('guenstig -> guenstig: no step-3 suffix matches (nothing in R2 to strip)', () => {
    // "guenstig" already ends in a consonant with no em/ern/er/en/es/e/s
    // (step 1), est/en/er/st/et (step 2), or end/ung/ig/ik/isch/lich/heit/keit
    // (step 3) suffix that clears its region -- "ig" requires cut >= R2 and
    // is otherwise a candidate, but R2("guenstig") lands past the "ig", so it
    // is not stripped. Fed the UNFOLDED form per stem.ts's contract (umlaut
    // transliterated internally, not pre-folded to "ue" by normalize()).
    expect(stem('günstig')).toBe('gunstig')
  })

  it('guenstige -> guenstig (step 1 strips -e)', () => {
    expect(stem('günstige')).toBe('gunstig')
  })

  it('bezirk -> bezirk (nothing to strip)', () => {
    expect(stem('bezirk')).toBe('bezirk')
  })

  it('bezirke -> bezirk (step 1 strips -e)', () => {
    expect(stem('bezirke')).toBe('bezirk')
  })

  // --- Additional pairs to reach 25+ ------------------------------------------
  it('sucht -> sucht: Snowball German does not strip the verbal 3rd-person "-t"', () => {
    // Divergence from a naive assumption (sucht -> such), documented:
    // Snowball's German step 1/2/3 suffix lists (see file header) contain no
    // bare "-t" ending; the stemmer is built for nominal inflection and
    // derivation, not full verb conjugation. "sucht" ends in "ht", which
    // matches none of step 2's est/en/er/st/et either (it is "ht", not "st"
    // or "et"). A faithful implementation leaves it unchanged.
    expect(stem('sucht')).toBe('sucht')
  })

  it('wohnungssuche -> wohnungssuch: step 1 strips the final -e in R1', () => {
    expect(stem('wohnungssuche')).toBe('wohnungssuch')
  })

  it('kindergarten -> kindergart: step 2 strips -en', () => {
    expect(stem('kindergarten')).toBe('kindergart')
  })

  it('installateur -> installateur (nothing to strip)', () => {
    expect(stem('installateur')).toBe('installateur')
  })

  it('handwerker -> handwerk (step 1 strips -er)', () => {
    expect(stem('handwerker')).toBe('handwerk')
  })

  it('empfehlung -> empfehl (step 3 strips -ung)', () => {
    expect(stem('empfehlung')).toBe('empfehl')
  })

  it('empfehlungen -> empfehl (step 1 strips -en, then step 3 strips -ung)', () => {
    expect(stem('empfehlungen')).toBe('empfehl')
  })

  it('zuverlaessig -> zuverlaess: step 3 strips -ig (not preceded by "e")', () => {
    expect(stem('zuverlässig')).toBe('zuverlass')
  })

  it('zuverlaessige -> zuverlaess: step 1 strips -e, then step 3 strips -ig', () => {
    expect(stem('zuverlässige')).toBe('zuverlass')
  })

  it('betreuung -> betreu (step 3 strips -ung)', () => {
    expect(stem('betreuung')).toBe('betreu')
  })

  it('betreuungsplatz -> betreuungsplatz: nothing in R1/R2 to strip (word ends in a consonant cluster, no matching suffix)', () => {
    expect(stem('betreuungsplatz')).toBe('betreuungsplatz')
  })

  it('freiwerdende -> freiwerd: step 1 strips -e, THEN step 3 strips -end from the result', () => {
    // Divergence from a first-pass assumption (freiwerdende -> freiwerdend),
    // documented: steps run in sequence on the progressively-stripped word,
    // not "whichever step applies once". Step 1 strips the final "-e"
    // (R1("freiwerdende") = 5, cut for "e" = 11 >= 5) giving "freiwerdend".
    // Step 3 then re-examines THAT word: it ends in "-end", and
    // R2("freiwerdende") = 7 <= cut(8), so "-end" is in R2 and gets
    // stripped too, landing on "freiwerd". This cascade is correct,
    // faithful Snowball behaviour, not a bug.
    expect(stem('freiwerdende')).toBe('freiwerd')
  })

  it('kassenaerztin -> kassenaerztin (feminine noun, not an -erin agent form; nothing to strip)', () => {
    expect(stem('kassenärztin')).toBe('kassenarztin')
  })

  it('zuverlaessigkeit -> zuverlaess: step 3 strips -keit, and its own preceding -ig is dropped too (both within R2)', () => {
    expect(stem('zuverlässigkeit')).toBe('zuverlass')
  })

  it('gemeindebauwohnung -> gemeindebauwohn: step 3 strips -ung (unlike bare "wohnung")', () => {
    // Divergence from a first-pass assumption, documented: R1/R2 depend on
    // the WHOLE word's vowel/consonant structure from its own start, not on
    // where a suffix "originally" came from. Bare "wohnung" keeps its "-ung"
    // (R2("wohnung") = 6, cut for "ung" = 4 < 6 -> not in R2). But in the
    // 19-letter compound "gemeindebauwohnung", R1/R2 are anchored much
    // earlier (by "gemeinde..."'s own vowel pattern), so the same "-ung" at
    // the tail now sits comfortably inside R2 and IS stripped. This is why
    // lexical.ts stems each COMPOUND PART separately (via compound.ts's
    // splitCompound) rather than stemming the whole un-split token: stemming
    // "gemeindebauwohnung" as one word does not reduce to "wohnung", but
    // splitting it into ["gemeindebau","wohnung"] and stemming each part
    // does.
    expect(stem('gemeindebauwohnung')).toBe('gemeindebauwohn')
  })

  it('waschbecken -> waschbeck: step 1 strips -en', () => {
    expect(stem('waschbecken')).toBe('waschbeck')
  })

  it('is idempotent on words with nothing left to strip', () => {
    expect(stem(stem('wohnung'))).toBe('wohnung')
    expect(stem(stem('such'))).toBe('such')
  })

  it('handles ß (transliterated to ss internally)', () => {
    expect(stem('straße')).toBe('strass')
    expect(stem('strassen')).toBe('strass')
  })
})
