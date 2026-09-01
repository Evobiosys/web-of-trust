import { describe, it, expect } from 'vitest'
import { matchTemplate } from '../src/match/lexical'
import type { ChatThread, ChatMessage, QueryTemplate } from '../src/types'

/**
 * The anonymity floor must count DISTINCT AUTHORS, never messages.
 *
 * This is the test that exists because the first implementation counted
 * messages. Seven messages from one neighbour cleared a floor of seven, and
 * every one of them was hers, so the floor that is meant to stop an offer being
 * traced back to a single person protected nobody.
 */

const msg = (author: string, text: string): ChatMessage => ({
  ts: '2026-08-15T12:00:00.000Z',
  author,
  text,
  system: false,
})

const thread = (messages: ChatMessage[]): ChatThread => ({
  id: 't1',
  title: 'Testgruppe',
  kind: 'group',
  participants: [...new Set(messages.map((m) => m.author))],
  messages,
  source: 'seed',
  included: true,
})

const template = (kThreshold: number): QueryTemplate => ({
  id: 'test.floor',
  version: 1,
  category: 'test',
  title: { de: 'Test', en: 'Test' },
  question: { de: 'Test?', en: 'Test?' },
  matchTerms: ['wohnung'],
  boostTerms: [],
  excludeTerms: [],
  minScore: 1,
  kThreshold,
  sensitivity: 'low',
  ttlSeconds: 3600,
})

describe('anonymity floor', () => {
  it('does NOT clear a floor of 3 from one author writing three times', () => {
    const t = thread([
      msg('Steffi', 'wohnung wird frei'),
      msg('Steffi', 'die wohnung ist im 16.'),
      msg('Steffi', 'wohnung hat zwei zimmer'),
    ])
    const r = matchTemplate(template(3), [t])
    expect(r.hits.length).toBe(3)
    expect(r.distinctAuthors).toBe(1)
    expect(r.aboveThreshold).toBe(false)
  })

  it('clears a floor of 3 when three different people wrote', () => {
    const t = thread([
      msg('Steffi', 'wohnung wird frei'),
      msg('Rosa', 'ich kenn auch eine wohnung'),
      msg('Kevin', 'wohnung im nachbarhaus'),
    ])
    const r = matchTemplate(template(3), [t])
    expect(r.distinctAuthors).toBe(3)
    expect(r.aboveThreshold).toBe(true)
  })

  it('treats the same person as one author regardless of case or padding', () => {
    const t = thread([
      msg('Steffi', 'wohnung a'),
      msg('steffi', 'wohnung b'),
      msg('  Steffi  ', 'wohnung c'),
    ])
    const r = matchTemplate(template(2), [t])
    expect(r.distinctAuthors).toBe(1)
    expect(r.aboveThreshold).toBe(false)
  })

  it('never counts an excluded thread toward the floor', () => {
    const included = thread([msg('Steffi', 'wohnung wird frei')])
    const excluded: ChatThread = {
      ...thread([msg('Rosa', 'wohnung a'), msg('Kevin', 'wohnung b')]),
      id: 't2',
      kind: 'direct',
      included: false,
    }
    const r = matchTemplate(template(3), [included, excluded])
    expect(r.distinctAuthors).toBe(1)
    expect(r.aboveThreshold).toBe(false)
  })

  it('a floor of 1 is cleared by a single author, which is what the demo relies on', () => {
    const t = thread([msg('Steffi', 'wohnung wird frei')])
    const r = matchTemplate(template(1), [t])
    expect(r.distinctAuthors).toBe(1)
    expect(r.aboveThreshold).toBe(true)
  })

  it('is deterministic across repeated runs', () => {
    const t = thread([msg('Steffi', 'wohnung a'), msg('Rosa', 'wohnung b')])
    const a = matchTemplate(template(2), [t])
    const b = matchTemplate(template(2), [t])
    expect(a.distinctAuthors).toBe(b.distinctAuthors)
    expect(a.aboveThreshold).toBe(b.aboveThreshold)
  })
})
