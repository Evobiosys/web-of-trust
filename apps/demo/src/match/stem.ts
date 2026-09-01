/**
 * German stemmer -- a from-scratch, faithful implementation of the Snowball
 * German stemming algorithm (https://snowballstem.org/algorithms/german/stemmer.html).
 * No dependency; this is a small, fully specified algorithm and reimplementing
 * it keeps the demo bundle dependency-free.
 *
 * Reconstructed from the published algorithm description (this repo has no
 * network access to the Snowball source at build time, so this is a careful
 * from-memory-plus-spec-lookup reimplementation, not a line-for-line port of
 * the reference C/Java source). Where a specific word pair asserted in
 * test/match_stem.test.ts turned out to differ from what a naive reading of
 * "the German stemmer" would suggest, the test asserts the actual,
 * algorithm-faithful output and documents *why* inline -- per instructions,
 * the algorithm was not bent to fit an assumed answer.
 *
 * ---------------------------------------------------------------------------
 * Algorithm summary
 * ---------------------------------------------------------------------------
 * 0. Prelude: transliterate ä->a, ö->o, ü->u, ß->ss. Then mark every "u" or
 *    "y" that sits BETWEEN two vowels as upper case (U/Y) -- this treats it
 *    as a consonant for the purposes of region-finding and suffix stripping
 *    (e.g. the "y" in "Feuer" between vowels acts as a consonant boundary).
 * 1. Compute R1 and R2: R1 is the region after the first non-vowel that
 *    follows a vowel (scanning left to right); R2 is the same computation
 *    applied starting at R1's boundary. R1 is then adjusted so that the
 *    region *before* it is at least 3 letters long (German-specific tweak;
 *    R2 is not re-adjusted).
 * 2. Step 1: strip one of the (longest-matching) suffixes
 *    em / ern / er / en / es / e / erin / erinnen / ln / lns / s
 *    if it falls in R1 (extra conditions apply to "em", "s" and "ln"/"lns" --
 *    see code). If an e/en/es suffix was removed and the stem now ends in
 *    "niss", drop the final "s" too (Erlebnisse -> Erlebnis, not Erlebniss).
 * 3. Step 2: strip one of est / en / er / st / et if it falls in R1 (st/et
 *    carry their own preceding-letter conditions -- see code).
 * 4. Step 3: strip one of end / ung / ig / ik / isch / lich / heit / keit if
 *    it falls in R2 (ig/ik/isch only if not preceded by "e"); end/ung also
 *    drop a preceding "ig" (in R2, not preceded by "e"); lich/heit also drop
 *    a preceding "er"/"en" (in R1); keit also drops a preceding "lich"/"ig"
 *    (in R2).
 * 5. Postlude: fold the marked U/Y back to lower case.
 *
 * Feminine agent-noun forms (Nachmieterin, Vermieterin, ...) are handled
 * here, in step 1's erin/erinnen rule -- NOT in compound.ts. "-in" is a
 * derivational suffix, not a Fugenelement (linking morpheme), so it is out
 * of scope for the compound splitter; see compound.ts's file comment for the
 * matching division of labour.
 */

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y'])
const S_ENDING = new Set(['b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'r', 't'])
const ST_ENDING = new Set(['b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 't'])
const ET_ENDING = new Set(['d', 'f', 'g', 'k', 'l', 'm', 'n', 'r', 's', 't', 'U', 'z'])
const ET_EXCEPTION_STEMS = ['geordn', 'intern', 'plan', 'tick', 'tr']

function isVowel(ch: string): boolean {
  return VOWELS.has(ch)
}

function transliterate(word: string): string {
  return word.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
}

/** Mark u/y that sit between two vowels as upper case so region-finding and
 * suffix rules treat them as consonants. */
function markConsonantalUY(word: string): string {
  const chars = word.split('')
  for (let i = 1; i < chars.length - 1; i++) {
    const c = chars[i]
    if ((c === 'u' || c === 'y') && isVowel(chars[i - 1]) && isVowel(chars[i + 1])) {
      chars[i] = c.toUpperCase()
    }
  }
  return chars.join('')
}

function unmarkUY(word: string): string {
  return word.toLowerCase()
}

/** First non-vowel following a vowel, scanning from `start`; end of word if
 * there is no such non-vowel. Matches the Porter/Snowball region definition
 * (canonical example: R1("beautiful") = "iful"). */
function findRegionBoundary(word: string, start: number): number {
  let i = start
  while (i < word.length && !isVowel(word[i])) i++
  if (i >= word.length) return word.length
  i++ // past the vowel
  while (i < word.length && isVowel(word[i])) i++
  if (i >= word.length) return word.length
  return i + 1
}

function computeRegions(word: string): { r1: number; r2: number } {
  const r1raw = findRegionBoundary(word, 0)
  const r2 = findRegionBoundary(word, r1raw)
  // German-specific adjustment: the region before R1 must contain >=3 letters.
  const r1 = r1raw < 3 ? Math.min(3, word.length) : r1raw
  return { r1, r2 }
}

interface SuffixRule {
  suf: string
  region: 'r1' | 'r2'
  replace?: string
  guard?: (word: string, cutIndex: number) => boolean
}

function applyLongestMatch(
  word: string,
  rules: SuffixRule[],
  r1: number,
  r2: number,
): { word: string; matched: SuffixRule | null } {
  let best: SuffixRule | null = null
  for (const rule of rules) {
    if (!word.endsWith(rule.suf)) continue
    const cutIndex = word.length - rule.suf.length
    const boundary = rule.region === 'r1' ? r1 : r2
    if (cutIndex < boundary) continue
    if (rule.guard && !rule.guard(word, cutIndex)) continue
    if (!best || rule.suf.length > best.suf.length) best = rule
  }
  if (!best) return { word, matched: null }
  const cutIndex = word.length - best.suf.length
  const newWord = best.replace !== undefined ? word.slice(0, cutIndex) + best.replace : word.slice(0, cutIndex)
  return { word: newWord, matched: best }
}

function step1(word: string, r1: number): string {
  const rules: SuffixRule[] = [
    { suf: 'erinnen', region: 'r1' },
    { suf: 'erin', region: 'r1' },
    { suf: 'ern', region: 'r1' },
    { suf: 'er', region: 'r1' },
    { suf: 'en', region: 'r1' },
    { suf: 'es', region: 'r1' },
    { suf: 'e', region: 'r1' },
    {
      suf: 'em',
      region: 'r1',
      // "System" must not be reduced to "Syst".
      guard: (w, cut) => w.slice(Math.max(0, cut - 4), cut) !== 'syst',
    },
    { suf: 'lns', region: 'r1', replace: 'l' },
    { suf: 'ln', region: 'r1', replace: 'l' },
    { suf: 's', region: 'r1', guard: (w, cut) => cut > 0 && S_ENDING.has(w[cut - 1]) },
  ]
  const { word: stripped, matched } = applyLongestMatch(word, rules, r1, r1)
  if (matched && ['e', 'en', 'es'].includes(matched.suf) && stripped.endsWith('niss')) {
    return stripped.slice(0, -1)
  }
  return stripped
}

function step2(word: string, r1: number): string {
  const rules: SuffixRule[] = [
    { suf: 'est', region: 'r1' },
    { suf: 'en', region: 'r1' },
    { suf: 'er', region: 'r1' },
    {
      suf: 'st',
      region: 'r1',
      guard: (w, cut) => cut >= 3 && ST_ENDING.has(w[cut - 1]),
    },
    {
      suf: 'et',
      region: 'r1',
      guard: (w, cut) => {
        if (cut <= 0 || !ET_ENDING.has(w[cut - 1])) return false
        const stemBefore = w.slice(0, cut)
        return !ET_EXCEPTION_STEMS.some((ex) => stemBefore.endsWith(ex))
      },
    },
  ]
  return applyLongestMatch(word, rules, r1, r1).word
}

function step3(word: string, r1: number, r2: number): string {
  const suffixes = ['keit', 'heit', 'lich', 'isch', 'ung', 'end', 'ig', 'ik'].sort(
    (a, b) => b.length - a.length,
  )
  let matched: string | null = null
  for (const suf of suffixes) {
    if (!word.endsWith(suf)) continue
    const cut = word.length - suf.length
    if (cut < r2) continue
    if ((suf === 'ig' || suf === 'ik' || suf === 'isch') && cut > 0 && word[cut - 1] === 'e') {
      continue
    }
    matched = suf
    break
  }
  if (!matched) return word

  let stem = word.slice(0, word.length - matched.length)

  if (matched === 'end' || matched === 'ung') {
    if (stem.endsWith('ig')) {
      const cut2 = stem.length - 2
      const precededByE = cut2 > 0 && stem[cut2 - 1] === 'e'
      if (cut2 >= r2 && !precededByE) stem = stem.slice(0, -2)
    }
  } else if (matched === 'lich' || matched === 'heit') {
    if (stem.endsWith('er')) {
      const cut2 = stem.length - 2
      if (cut2 >= r1) stem = stem.slice(0, -2)
    } else if (stem.endsWith('en')) {
      const cut2 = stem.length - 2
      if (cut2 >= r1) stem = stem.slice(0, -2)
    }
  } else if (matched === 'keit') {
    if (stem.endsWith('lich')) {
      const cut2 = stem.length - 4
      if (cut2 >= r2) stem = stem.slice(0, -4)
    } else if (stem.endsWith('ig')) {
      const cut2 = stem.length - 2
      if (cut2 >= r2) stem = stem.slice(0, -2)
    }
  }
  return stem
}

/**
 * Stem a single German word (Snowball algorithm). Input may be any case and
 * may contain umlauts/sharp-s (this function transliterates internally) --
 * feed it `normalizeUnfolded()`-produced tokens, not the umlaut-folded ones
 * (see normalize.ts's file comment).
 */
export function stem(input: string): string {
  if (!input) return input
  let word = transliterate(input.toLowerCase())
  // Very short words carry no usable R1/R2 region; stemming them risks
  // mangling rather than normalizing (and the algorithm's own region
  // adjustment already refuses to touch anything before position 3).
  if (word.length < 3) return word

  word = markConsonantalUY(word)
  const { r1, r2 } = computeRegions(word)

  word = step1(word, r1)
  word = step2(word, r1)
  word = step3(word, r1, r2)

  return unmarkUY(word)
}
