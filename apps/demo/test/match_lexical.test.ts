import { describe, expect, it } from 'vitest'
import { matchTemplate } from '../src/match/lexical'
import type { ChatMessage, ChatThread, QueryTemplate } from '../src/types'

function msg(text: string, opts: Partial<ChatMessage> = {}): ChatMessage {
  return {
    ts: opts.ts ?? '2026-08-16T17:10:00',
    author: opts.author ?? 'Steffi',
    text,
    system: opts.system ?? false,
  }
}

function thread(id: string, messages: ChatMessage[], opts: Partial<ChatThread> = {}): ChatThread {
  return {
    id,
    title: opts.title ?? id,
    kind: opts.kind ?? 'group',
    participants: opts.participants ?? ['Steffi', 'Klaus'],
    messages,
    source: opts.source ?? 'seed',
    included: opts.included ?? true,
  }
}

function baseTemplate(overrides: Partial<QueryTemplate> = {}): QueryTemplate {
  return {
    id: 'test.template',
    version: 1,
    category: 'test',
    title: { de: 'Test', en: 'Test' },
    question: { de: 'Test?', en: 'Test?' },
    matchTerms: ['wohnung frei', 'nachmieter'],
    boostTerms: ['dringend'],
    excludeTerms: ['willhaben.at'],
    minScore: 1,
    kThreshold: 1,
    sensitivity: 'low',
    ttlSeconds: 60,
    ...overrides,
  }
}

describe('matchTemplate', () => {
  it('finds a hit for a matching message in an included group thread', () => {
    const t = baseTemplate()
    const threads = [thread('g1', [msg('bei uns wird bald eine wohnung frei')])]
    const result = matchTemplate(t, threads)
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0].threadId).toBe('g1')
    expect(result.hits[0].messageIndex).toBe(0)
    expect(result.hits[0].terms).toContain('wohnung frei')
  })

  it('a 1-on-1 thread not opted in is INVISIBLE to matching -- its content can never appear in a hit', () => {
    const t = baseTemplate()
    const threads = [
      thread('direct-1', [msg('die wohnung wird ganz sicher bald frei, ruf mich an')], {
        kind: 'direct',
        included: false,
      }),
      thread('group-1', [msg('nix wichtiges heute')], { kind: 'group', included: true }),
    ]
    const result = matchTemplate(t, threads)
    expect(result.hits).toHaveLength(0)
    // Prove it structurally, not just by absence of a score: no hit anywhere
    // in the result references the excluded thread, under any field.
    expect(result.hits.every((h) => h.threadId !== 'direct-1')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('ruf mich an')
  })

  it('an included direct thread with included:true IS visible', () => {
    const t = baseTemplate()
    const threads = [
      thread('direct-2', [msg('bei uns wird bald eine wohnung frei')], {
        kind: 'direct',
        included: true,
      }),
    ]
    const result = matchTemplate(t, threads)
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0].threadId).toBe('direct-2')
  })

  it('skips system messages entirely', () => {
    const t = baseTemplate()
    const threads = [
      thread('g1', [msg('Klaus hat die Gruppe verlassen wohnung frei', { system: true })]),
    ]
    const result = matchTemplate(t, threads)
    expect(result.hits).toHaveLength(0)
  })

  it('excludeTerms are a hard veto even when matchTerms also fire', () => {
    const t = baseTemplate()
    const threads = [
      thread('g1', [
        msg('schau: https://www.willhaben.at/iad/xyz die wohnung wird frei'),
      ]),
    ]
    const result = matchTemplate(t, threads)
    expect(result.hits).toHaveLength(0)
  })

  it('boostTerms score higher than matchTerms', () => {
    const t = baseTemplate({ matchTerms: ['nachmieter'], boostTerms: ['dringend'], minScore: 1 })
    const threads = [
      thread('g1', [
        msg('nachmieter gesucht', { ts: '2026-08-16T10:00:00' }),
        msg('dringend! wer kennt jemanden', { ts: '2026-08-16T10:01:00' }),
      ]),
    ]
    const result = matchTemplate(t, threads)
    expect(result.hits).toHaveLength(2)
    // boost (weight 2) outranks a single match term (weight 1)
    expect(result.hits[0].messageIndex).toBe(1)
    expect(result.hits[0].score).toBeGreaterThan(result.hits[1].score)
  })

  it('matches single-word terms against stemmed AND compound-split tokens', () => {
    const t = baseTemplate({ matchTerms: ['wohnung'], boostTerms: [], excludeTerms: [] })
    const threads = [thread('g1', [msg('meine wohnungssuche läuft schon ewig')])]
    const result = matchTemplate(t, threads)
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0].terms).toContain('wohnung')
  })

  it('matches Nachmieterin against a "nachmieter" term via stemming (feminine agent-noun form)', () => {
    const t = baseTemplate({ matchTerms: ['nachmieter'], boostTerms: [], excludeTerms: [] })
    const threads = [thread('g1', [msg('kennt jemand eine Nachmieterin für die Wohnung')])]
    const result = matchTemplate(t, threads)
    expect(result.hits).toHaveLength(1)
  })

  it('respects minScore: a single generic match does not clear a minScore of 2', () => {
    const t = baseTemplate({
      matchTerms: ['warteliste'],
      boostTerms: [],
      excludeTerms: [],
      minScore: 2,
    })
    const threads = [thread('g1', [msg('steht auf der warteliste seit monaten')])]
    const result = matchTemplate(t, threads)
    expect(result.hits).toHaveLength(0)
  })

  it('aboveThreshold reflects kThreshold, independent of minScore', () => {
    const t = baseTemplate({
      matchTerms: ['nachmieter'],
      boostTerms: [],
      excludeTerms: [],
      minScore: 1,
      kThreshold: 2,
    })
    const threads = [thread('g1', [msg('nachmieter gesucht bitte melden')])]
    const result = matchTemplate(t, threads)
    expect(result.hits).toHaveLength(1)
    expect(result.aboveThreshold).toBe(false)
  })

  it('is deterministic: identical input yields identical hit ordering across repeated runs', () => {
    const t = baseTemplate({ matchTerms: ['nachmieter'], boostTerms: [], excludeTerms: [] })
    const threads = [
      thread('b-thread', [msg('nachmieter gesucht', { ts: '1' })]),
      thread('a-thread', [msg('nachmieter gesucht auch hier', { ts: '2' })]),
    ]
    const r1 = matchTemplate(t, threads)
    const r2 = matchTemplate(t, threads)
    expect(r1).toEqual(r2)
  })

  it('breaks score ties by (threadId, messageIndex), not by input/object order', () => {
    const t = baseTemplate({ matchTerms: ['nachmieter'], boostTerms: [], excludeTerms: [] })
    // "z-thread" is passed in FIRST but must sort AFTER "a-thread" on a tie.
    const threads = [
      thread('z-thread', [msg('nachmieter gesucht')]),
      thread('a-thread', [msg('nachmieter gesucht')]),
    ]
    const result = matchTemplate(t, threads)
    expect(result.hits).toHaveLength(2)
    expect(result.hits[0].score).toBe(result.hits[1].score)
    expect(result.hits[0].threadId).toBe('a-thread')
    expect(result.hits[1].threadId).toBe('z-thread')
  })

  it('breaks same-thread score ties by ascending messageIndex', () => {
    const t = baseTemplate({ matchTerms: ['nachmieter'], boostTerms: [], excludeTerms: [] })
    const threads = [
      thread('g1', [
        msg('erste nachmieter frage', { ts: '1' }),
        msg('zweite nachmieter frage', { ts: '2' }),
      ]),
    ]
    const result = matchTemplate(t, threads)
    expect(result.hits.map((h) => h.messageIndex)).toEqual([0, 1])
  })

  it('returns no hits and aboveThreshold=false for an empty thread list', () => {
    const t = baseTemplate()
    const result = matchTemplate(t, [])
    expect(result.hits).toEqual([])
    expect(result.aboveThreshold).toBe(false)
  })
})
