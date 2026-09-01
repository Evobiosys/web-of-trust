import { describe, expect, it } from 'vitest'
import { normalize, normalizeUnfolded, tokenize, tokenizeUnfolded } from '../src/match/normalize'

describe('normalize', () => {
  it('lowercases', () => {
    expect(normalize('WOHNUNG')).toBe('wohnung')
    expect(normalize('Wohnung')).toBe('wohnung')
    expect(normalize('wohnung')).toBe('wohnung')
  })

  it('folds umlauts the German way', () => {
    expect(normalize('günstig')).toBe('guenstig')
    expect(normalize('schön')).toBe('schoen')
    expect(normalize('Übertragung')).toBe('uebertragung')
    expect(normalize('Straße')).toBe('strasse')
  })

  it('strips punctuation to spaces and collapses whitespace', () => {
    expect(normalize('2-Zi-Whg, sofort frei!')).toBe('2 zi whg sofort frei')
    expect(normalize('Wohnung...frei??')).toBe('wohnung frei')
    expect(normalize('  viele   Leerzeichen  ')).toBe('viele leerzeichen')
  })

  it('strips invisible marks (LRM, narrow no-break space, NBSP)', () => {
    const lrm = '\u200E'
    const nnbsp = '\u202F'
    const nbsp = '\u00A0'
    expect(normalize(`${lrm}Steffi: wohnung${nnbsp}frei${nbsp}bald`)).toBe(
      'steffi wohnung frei bald',
    )
  })

  it('strips emoji without merging the words around it', () => {
    expect(normalize('danke\u{1F64F}schoen')).toBe('danke schoen')
    expect(normalize('servas allerseits \u{1F44B}')).toBe('servas allerseits')
    expect(normalize('mega danke \u{1F64F}\u{1F44D}')).toBe('mega danke')
    // flag sequence (regional indicators) must not leave stray letters behind
    expect(normalize('urlaub \u{1F1E6}\u{1F1F9} bald')).toBe('urlaub bald')
  })

  it('keeps a folded and an unfolded variant available', () => {
    expect(normalize('Kassenärztin')).toBe('kassenaerztin')
    expect(normalizeUnfolded('Kassenärztin')).toBe('kassenärztin')
    expect(normalizeUnfolded('STRASSE')).toBe('strasse')
    expect(normalizeUnfolded('WOHNUNG')).toBe('wohnung')
  })

  it('tokenizes on the folded form by default', () => {
    expect(tokenize('Kennt jemand eine Wohnung, die bald frei wird?')).toEqual([
      'kennt',
      'jemand',
      'eine',
      'wohnung',
      'die',
      'bald',
      'frei',
      'wird',
    ])
  })

  it('tokenizeUnfolded preserves umlauts per token', () => {
    expect(tokenizeUnfolded('günstige Wohnung')).toEqual(['günstige', 'wohnung'])
  })

  it('returns an empty array for empty/whitespace-only input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
    expect(tokenize('🙂')).toEqual([])
  })
})
