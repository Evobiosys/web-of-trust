import { describe, expect, it } from 'vitest'
import { matchTemplate } from '../src/match/lexical'
import { threadsInScope, addInventoryItem } from '../src/state'
import type { DeviceState } from '../src/state'
import type { InventoryItem, QueryTemplate } from '../src/types'

/**
 * "Was ich habe" runs through the exact same matcher as the chat corpus:
 * threadsInScope() (see state.ts) turns every included entry into a
 * synthetic ChatThread and hands it to the SAME matchTemplate() chats
 * already go through. There is no second scoring path to test separately --
 * these tests exercise that one path with inventory-shaped input.
 */

function baseState(overrides: Partial<DeviceState> = {}): DeviceState {
  return {
    me: { id: 'marlene0', displayName: 'Marlene' },
    threads: [],
    peers: [],
    profile: { displayName: 'Marlene', bio: '', neighbourhood: '', languages: [] },
    inventory: [],
    ...overrides,
  }
}

function entry(text: string, included: boolean, overrides: Partial<InventoryItem> = {}): InventoryItem {
  return { id: overrides.id ?? 'inv-1', text, createdAt: '2026-08-15T10:00:00.000Z', included, ...overrides }
}

function template(overrides: Partial<QueryTemplate> = {}): QueryTemplate {
  return {
    id: 'test.inventory',
    version: 1,
    category: 'test',
    title: { de: 'Test', en: 'Test' },
    question: { de: 'Test?', en: 'Test?' },
    matchTerms: ['bohrmaschine'],
    boostTerms: [],
    excludeTerms: [],
    minScore: 1,
    kThreshold: 1,
    sensitivity: 'low',
    ttlSeconds: 3600,
    ...overrides,
  }
}

describe('inventory entries matched via threadsInScope + matchTemplate', () => {
  it('an included entry matches a template exactly like a chat message would', () => {
    const s = baseState({
      inventory: [entry('Hab eine Bohrmaschine daheim, kannst sie dir jederzeit ausborgen.', true)],
    })
    const result = matchTemplate(template(), threadsInScope(s))
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0].threadId).toBe('inv:inv-1')
    expect(result.hits[0].terms).toContain('bohrmaschine')
    expect(result.distinctAuthors).toBe(1)
    expect(result.aboveThreshold).toBe(true)
  })

  it('an excluded entry is unmatchable, and re-including it makes it matchable again', () => {
    const s = baseState({
      inventory: [entry('Hab eine Bohrmaschine daheim, kannst sie dir jederzeit ausborgen.', false)],
    })

    const excluded = matchTemplate(template(), threadsInScope(s))
    expect(excluded.hits).toHaveLength(0)
    // Prove it structurally, not just by absence of a score -- mirrors
    // match_lexical.test.ts's "content can never appear in a hit" assertion.
    expect(JSON.stringify(excluded)).not.toContain('ausborgen')

    s.inventory[0].included = true
    const included = matchTemplate(template(), threadsInScope(s))
    expect(included.hits).toHaveLength(1)
    expect(included.hits[0].threadId).toBe('inv:inv-1')
  })

  it('a newly typed entry defaults to included, unlike a 1-on-1 chat', () => {
    const s = baseState()
    const item = addInventoryItem(s, 'Hab ein Lastenrad, frag einfach kurz.')
    expect(item.included).toBe(true)
    const result = matchTemplate(template({ matchTerms: ['lastenrad'] }), threadsInScope(s))
    expect(result.hits).toHaveLength(1)
  })

  it('the seeded T1 pre-listing entry fires the real production template, not a test stub', async () => {
    // Demo-critical: "she types a line, the room sees that line found." This
    // pins the specific seed entry (state.ts PERSONAS) against the actual
    // shipped template, so a future edit to either one that breaks the demo
    // beat fails loudly here instead of live in Vienna.
    const { PERSONAS } = await import('../src/state')
    const { TEMPLATES } = await import('../src/data/templates')
    const marlene = PERSONAS.find((p) => p.id === 'marlene0')!
    const seedText = marlene.inventorySeed.find((e) => e.text.includes('Hausverwaltung'))!.text
    const s = baseState({ inventory: [entry(seedText, true)] })
    const t1 = TEMPLATES.find((tpl) => tpl.id === 'wot.vienna.housing.flat_pre_listing')!
    const result = matchTemplate(t1, threadsInScope(s))
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits.some((h) => h.threadId.startsWith('inv:'))).toBe(true)
    expect(result.aboveThreshold).toBe(true) // T1's demo kThreshold is 1
  })

  it('one distinct author across a chat message and an inventory entry counts once, not twice', () => {
    const s = baseState({
      threads: [
        {
          id: 'g1',
          title: 'Otta Grätzl & Alltag',
          kind: 'group',
          participants: ['Marlene'],
          messages: [{ ts: '2026-08-15T09:00:00.000Z', author: 'Marlene', text: 'bohrmaschine da, sag bescheid', system: false }],
          source: 'seed',
          included: true,
        },
      ],
      inventory: [entry('Hab eine Bohrmaschine daheim, kannst sie dir jederzeit ausborgen.', true)],
    })
    const result = matchTemplate(template({ kThreshold: 1 }), threadsInScope(s))
    expect(result.hits).toHaveLength(2)
    expect(result.distinctAuthors).toBe(1) // same person, same normalized author key
  })
})
