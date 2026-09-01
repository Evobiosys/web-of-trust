/**
 * Text normalization for the German lexical matcher.
 *
 * Two normalized variants exist on purpose:
 *  - `normalize()` folds umlauts (ae/oe/ue/ss) so that a word typed with an
 *    actual umlaut, one typed with its ASCII digraph, and any casing all
 *    converge on one comparable ASCII form. This is the variant
 *    `matchTemplate` compares message text and template terms against.
 *  - `normalizeUnfolded()` keeps umlauts and sharp-s as their own letters
 *    (only case, invisibles and punctuation are normalized). The Snowball
 *    German stemmer (see stem.ts) transliterates umlauts and sharp-s
 *    *internally* as its own first step; feeding it the already-folded form
 *    would double-fold the word, which shifts the R1/R2 region math the
 *    stemmer depends on. stem.ts therefore always consumes the unfolded
 *    variant (see normalizeUnfolded / tokenizeUnfolded below).
 */

// Genuinely zero-width / bidi-control code points that show up in real chat
// exports and occupy NO visual space, so they are deleted outright:
// U+200B ZERO WIDTH SPACE, U+200C ZWNJ, U+200D ZWJ, U+200E LRM, U+200F RLM,
// U+202A-U+202E bidi embedding/override controls, U+2060 WORD JOINER,
// U+2061-U+2064 invisible math operators, U+FEFF BYTE ORDER MARK / ZERO
// WIDTH NO-BREAK SPACE.
const INVISIBLE_RE =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g

// Word-separating but non-ASCII space characters (U+00A0 NO-BREAK SPACE,
// U+202F NARROW NO-BREAK SPACE): these DO separate words visually, so they
// must become a literal space, never be deleted -- deleting them would glue
// "wohnung<NBSP>frei" into "wohnungfrei".
const SPACE_LIKE_RE = /[\u00A0\u202F]/g

// Emoji / pictographic / symbol ranges, plus emoji-modifier and tag marks
// used to build multi-codepoint emoji (skin tones, flags, joined sequences).
// Matched and replaced with a space so two words either side of an emoji
// never get glued together (e.g. "danke\u{1F64F}schoen" -> "danke schoen",
// not "dankeschoen").
const EMOJI_RE =
  /[\u{1F000}-\u{1FFFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{2600}-\u{26FF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{E0020}-\u{E007F}]/gu

// Anything that is not a letter, a digit or whitespace, once emoji/invisibles
// are already gone. \p{L} covers accented/umlauted letters.
const PUNCT_RE = /[^\p{L}\p{N}\s]/gu

const WHITESPACE_RE = /\s+/g

function stripInvisiblesAndEmoji(s: string): string {
  return s.replace(INVISIBLE_RE, '').replace(SPACE_LIKE_RE, ' ').replace(EMOJI_RE, ' ')
}

function foldUmlauts(s: string): string {
  return s
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
}

function finish(s: string): string {
  return s.replace(PUNCT_RE, ' ').replace(WHITESPACE_RE, ' ').trim()
}

/**
 * Lowercase, strip invisibles/emoji, fold umlauts the German way, strip
 * punctuation to spaces, collapse whitespace. This is the canonical form
 * used for phrase/term matching everywhere in the matcher.
 */
export function normalize(s: string): string {
  const stripped = stripInvisiblesAndEmoji(s).toLowerCase()
  return finish(foldUmlauts(stripped))
}

/**
 * Same pipeline as normalize(), but WITHOUT umlaut folding. Feed this to the
 * stemmer, never to term/phrase matching.
 */
export function normalizeUnfolded(s: string): string {
  const stripped = stripInvisiblesAndEmoji(s).toLowerCase()
  return finish(stripped)
}

/** Whitespace-split tokens of the folded, canonical normalized form. */
export function tokenize(s: string): string[] {
  const n = normalize(s)
  return n.length ? n.split(' ') : []
}

/** Whitespace-split tokens of the unfolded (umlaut-preserving) form. */
export function tokenizeUnfolded(s: string): string[] {
  const n = normalizeUnfolded(s)
  return n.length ? n.split(' ') : []
}
