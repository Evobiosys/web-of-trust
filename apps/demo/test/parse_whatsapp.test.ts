import { describe, it, expect } from 'vitest'
import iosFixture from './fixtures/seed-corpus-wien-wohnen.txt?raw'
import androidFixture from './fixtures/seed-corpus-wien-wohnen-android.txt?raw'
import { parseWhatsApp } from '../src/parse/whatsapp'

describe('parseWhatsApp: basic line shapes', () => {
  it('parses a single iOS-format line (brackets, seconds)', () => {
    const thread = parseWhatsApp('[15.08.26, 19:42:11] Marlene: schau ma mal')
    expect(thread.messages).toHaveLength(1)
    expect(thread.messages[0]).toMatchObject({
      author: 'Marlene',
      text: 'schau ma mal',
      system: false,
    })
    expect(thread.source).toBe('whatsapp-ios')
  })

  it('parses a single Android-format line (no brackets, hyphen, no seconds)', () => {
    const thread = parseWhatsApp('15.08.26, 19:42 - Marlene: schau ma mal')
    expect(thread.messages).toHaveLength(1)
    expect(thread.messages[0]).toMatchObject({
      author: 'Marlene',
      text: 'schau ma mal',
      system: false,
    })
    expect(thread.source).toBe('whatsapp-android')
  })

  it('accepts the four-digit-year iOS variant [DD.MM.YYYY, ...]', () => {
    const thread = parseWhatsApp('[15.08.2026, 19:42:11] Marlene: schau ma mal')
    expect(thread.messages[0].ts).toBe('2026-08-15T19:42:11')
  })
})

describe('parseWhatsApp: multi-line messages (rule 1)', () => {
  it('joins continuation lines onto the previous message with \\n', () => {
    const raw = [
      '[15.08.26, 17:10:02] Steffi: apropos, meine tante zieht im herbst zu ihrer tochter',
      'nach graz um.',
      'die wohnung wird dann frei.',
      '[15.08.26, 17:12:03] Klaus: oh interessant',
    ].join('\n')
    const thread = parseWhatsApp(raw)
    expect(thread.messages).toHaveLength(2)
    expect(thread.messages[0].text).toBe(
      'apropos, meine tante zieht im herbst zu ihrer tochter\nnach graz um.\ndie wohnung wird dann frei.',
    )
    expect(thread.messages[1].text).toBe('oh interessant')
  })

  it('handles a multi-line Android message the same way', () => {
    const raw = ['15.08.26, 17:10 - Steffi: line one', 'line two', '15.08.26, 17:12 - Klaus: next msg'].join('\n')
    const thread = parseWhatsApp(raw)
    expect(thread.messages[0].text).toBe('line one\nline two')
    expect(thread.messages[1].text).toBe('next msg')
  })

  it('drops stray lines that appear before any timestamp has ever matched', () => {
    const raw = ['some header junk with no timestamp', '[15.08.26, 10:00:00] Marlene: hi'].join('\n')
    const thread = parseWhatsApp(raw)
    expect(thread.messages).toHaveLength(1)
    expect(thread.messages[0].text).toBe('hi')
  })
})

describe('parseWhatsApp: date/time parsing (rules 2, 3, 4)', () => {
  it('parses DD.MM.YY as day-month-year, never as US MM/DD', () => {
    // day=25 cannot be a month, so a MM/DD misparse would be caught here.
    const thread = parseWhatsApp('[25.01.26, 08:00:00] Marlene: hi')
    expect(thread.messages[0].ts).toBe('2026-01-25T08:00:00')
  })

  it('maps a two-digit year into 2000+', () => {
    const thread = parseWhatsApp('[01.01.26, 00:00:00] Marlene: hi')
    expect(thread.messages[0].ts.startsWith('2026-')).toBe(true)
  })

  it('defaults seconds to :00 when absent (Android)', () => {
    const thread = parseWhatsApp('15.08.26, 09:05 - Marlene: hi')
    expect(thread.messages[0].ts).toBe('2026-08-15T09:05:00')
  })

  it('keeps explicit seconds when present (iOS)', () => {
    const thread = parseWhatsApp('[15.08.26, 09:05:37] Marlene: hi')
    expect(thread.messages[0].ts).toBe('2026-08-15T09:05:37')
  })

  it('accepts a 12-hour PM shape and converts it to 24-hour', () => {
    const thread = parseWhatsApp('[15.08.26, 7:42:11 PM] Marlene: hi')
    expect(thread.messages[0].ts).toBe('2026-08-15T19:42:11')
  })

  it('accepts a 12-hour 12 AM edge case as hour 00', () => {
    const thread = parseWhatsApp('[15.08.26, 12:00:00 AM] Marlene: hi')
    expect(thread.messages[0].ts).toBe('2026-08-15T00:00:00')
  })

  it('accepts a 12-hour 12 PM edge case as hour 12 (noon, unchanged)', () => {
    const thread = parseWhatsApp('[15.08.26, 12:15:00 PM] Marlene: hi')
    expect(thread.messages[0].ts).toBe('2026-08-15T12:15:00')
  })

  it('normalises a narrow no-break space (U+202F) before AM/PM', () => {
    // Built with an explicit \u202F escape, never a literal invisible byte.
    const raw = `[15.08.26, 7:42:11\u202FPM] Marlene: hi`
    const thread = parseWhatsApp(raw)
    expect(thread.messages[0].ts).toBe('2026-08-15T19:42:11')
  })

  it('strips U+200E LEFT-TO-RIGHT marks wherever they appear on the line', () => {
    // Built with explicit \u200E escapes, never literal invisible bytes.
    const raw = `[15.08.26, 19:42:11] \u200EMarlene: \u200Eschau ma mal`
    const thread = parseWhatsApp(raw)
    expect(thread.messages[0]).toMatchObject({ author: 'Marlene', text: 'schau ma mal' })
  })
})

describe('parseWhatsApp: system lines (rule 5)', () => {
  it('marks an end-to-end-encryption notice as system with no author', () => {
    const thread = parseWhatsApp(
      '[15.08.26, 08:03:12] Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt. Niemand außerhalb dieses Chats, nicht einmal WhatsApp, kann sie lesen oder anhören.',
    )
    expect(thread.messages[0]).toMatchObject({ author: '', system: true })
  })

  it('marks a "hat die Gruppe erstellt" notice as system with no author', () => {
    const thread = parseWhatsApp('[15.08.26, 08:03:12] Marlene hat die Gruppe "Otta Grätzl" erstellt.')
    expect(thread.messages[0]).toMatchObject({ author: '', system: true })
  })

  it('marks a "hat X hinzugefügt" member-add notice as system with no author', () => {
    const thread = parseWhatsApp('[15.08.26, 08:04:01] Marlene hat Basti hinzugefügt')
    expect(thread.messages[0]).toMatchObject({ author: '', system: true })
  })

  it('marks a "Du hast die Gruppenbeschreibung geändert" notice as system', () => {
    const thread = parseWhatsApp('[15.08.26, 08:04:01] Du hast die Gruppenbeschreibung geändert')
    expect(thread.messages[0]).toMatchObject({ author: '', system: true })
  })

  it('does not mistake a clock time ("19:00: ...") for an author separator', () => {
    const thread = parseWhatsApp('[01.01.26, 10:00:00] 19:00: Uhr wär super')
    expect(thread.messages[0]).toMatchObject({ author: '', system: true })
    expect(thread.messages[0].text).toBe('19:00: Uhr wär super')
  })

  it('does not mistake a bare URL ("https://...: ...") for an author separator', () => {
    const thread = parseWhatsApp('[01.01.26, 10:00:00] https://example.com/path: click here')
    expect(thread.messages[0]).toMatchObject({ author: '', system: true })
  })

  it('still finds the real author when the message TEXT contains a URL after "Name: "', () => {
    const thread = parseWhatsApp(
      '[15.08.26, 14:22:45] Marlene: https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz/xyz',
    )
    expect(thread.messages[0]).toMatchObject({
      author: 'Marlene',
      text: 'https://www.willhaben.at/iad/kaufen-und-verkaufen/marktplatz/xyz',
      system: false,
    })
  })

  it('still finds the real author when the message TEXT contains a clock time after "Name: "', () => {
    const thread = parseWhatsApp('[15.08.26, 09:47:20] Klaus: wegen sa flohmarkt, treffen um 19:00 oder so?')
    expect(thread.messages[0]).toMatchObject({ author: 'Klaus', system: false })
    expect(thread.messages[0].text).toContain('19:00')
  })
})

describe('parseWhatsApp: media placeholders (rule 6)', () => {
  it('normalises <Medien ausgeschlossen> and keeps it non-system', () => {
    const thread = parseWhatsApp('[15.08.26, 12:44:11] Marlene: <Medien ausgeschlossen>')
    expect(thread.messages[0]).toMatchObject({ author: 'Marlene', text: '[media omitted]', system: false })
  })

  it('normalises <Media omitted> and keeps it non-system', () => {
    const thread = parseWhatsApp('15.08.26, 12:44 - Marlene: <Media omitted>')
    expect(thread.messages[0]).toMatchObject({ author: 'Marlene', text: '[media omitted]', system: false })
  })

  it('normalises "Bild weggelassen"', () => {
    const thread = parseWhatsApp('[15.08.26, 12:44:11] Marlene: Bild weggelassen')
    expect(thread.messages[0]).toMatchObject({ text: '[media omitted]', system: false })
  })

  it('normalises "audio omitted"', () => {
    const thread = parseWhatsApp('[15.08.26, 12:44:11] Marlene: audio omitted')
    expect(thread.messages[0]).toMatchObject({ text: '[audio omitted]', system: false })
  })

  it('normalises "Sticker weggelassen"', () => {
    const thread = parseWhatsApp('[15.08.26, 12:44:11] Marlene: Sticker weggelassen')
    expect(thread.messages[0]).toMatchObject({ text: '[sticker omitted]', system: false })
  })

  it('does not crash on a real iOS attachment reference line', () => {
    const thread = parseWhatsApp('[15.08.26, 11:41:29] Fatima: <Anhang: 00000021-VCARD.vcf>')
    expect(thread.messages[0]).toMatchObject({ author: 'Fatima', system: false })
    expect(thread.messages[0].text).toContain('VCARD.vcf')
  })
})

describe('parseWhatsApp: deleted / edited markers (rule 7)', () => {
  it('handles a deleted-message marker without crashing', () => {
    const thread = parseWhatsApp('[15.08.26, 12:44:11] Klaus: Diese Nachricht wurde gelöscht.')
    expect(thread.messages).toHaveLength(1)
    expect(thread.messages[0]).toMatchObject({ author: 'Klaus', system: false })
    expect(thread.messages[0].text).toBe('Diese Nachricht wurde gelöscht.')
  })

  it('handles an edited-message marker without crashing', () => {
    const thread = parseWhatsApp('[15.08.26, 12:44:11] Klaus: <Diese Nachricht wurde bearbeitet>')
    expect(thread.messages).toHaveLength(1)
    expect(thread.messages[0].text).toBe('<Diese Nachricht wurde bearbeitet>')
  })
})

describe('parseWhatsApp: never throws on bad input (rule 8)', () => {
  it('returns zero messages for empty input', () => {
    const thread = parseWhatsApp('')
    expect(thread.messages).toHaveLength(0)
    expect(thread.participants).toHaveLength(0)
  })

  it('returns zero messages for whitespace-only input', () => {
    const thread = parseWhatsApp('   \n\n   ')
    expect(thread.messages).toHaveLength(0)
  })

  it('returns zero messages for garbage input with no parseable lines, and does not throw', () => {
    expect(() => parseWhatsApp('completely unrelated garbage\nmore garbage\n1234 !! nonsense')).not.toThrow()
    const thread = parseWhatsApp('completely unrelated garbage\nmore garbage\n1234 !! nonsense')
    expect(thread.messages).toHaveLength(0)
  })
})

describe('parseWhatsApp: thread metadata (participants, kind, included, title)', () => {
  it('sets kind "direct" and included=false for exactly two distinct authors', () => {
    const raw = ['[01.01.26, 10:00:00] Klaus: hi', '[01.01.26, 10:01:00] Marlene: hi zurück'].join('\n')
    const thread = parseWhatsApp(raw)
    expect(thread.kind).toBe('direct')
    expect(thread.included).toBe(false)
    expect(thread.participants.sort()).toEqual(['Klaus', 'Marlene'])
  })

  it('sets kind "group" and included=true for three or more distinct authors', () => {
    const raw = [
      '[01.01.26, 10:00:00] Klaus: hi',
      '[01.01.26, 10:01:00] Marlene: hi zurück',
      '[01.01.26, 10:02:00] Rosa: servas',
    ].join('\n')
    const thread = parseWhatsApp(raw)
    expect(thread.kind).toBe('group')
    expect(thread.included).toBe(true)
  })

  it('respects an explicit opts.title over any derived title', () => {
    const thread = parseWhatsApp('[01.01.26, 10:00:00] Klaus: hi', { title: 'My Custom Title' })
    expect(thread.title).toBe('My Custom Title')
  })

  it('derives the title from a "hat die Gruppe "X" erstellt" system line when no opts.title is given', () => {
    const raw = [
      '[15.08.26, 08:03:12] Marlene hat die Gruppe "Otta Grätzl & Alltag" erstellt.',
      '[15.08.26, 08:04:01] Marlene hat Basti hinzugefügt',
      '[15.08.26, 08:15:44] Marlene: servas',
      '[15.08.26, 08:22:10] Basti: passt',
      '[15.08.26, 08:41:33] Fatima: hi',
    ].join('\n')
    const thread = parseWhatsApp(raw)
    expect(thread.title).toBe('Otta Grätzl & Alltag')
  })

  it('falls back to a sensible generated title when no opts.title and no group-created line exists', () => {
    const thread = parseWhatsApp('[01.01.26, 10:00:00] Klaus: hi')
    expect(typeof thread.title).toBe('string')
    expect(thread.title.length).toBeGreaterThan(0)
  })
})

describe('parseWhatsApp: real iOS fixture (seed-corpus-wien-wohnen.txt)', () => {
  const thread = parseWhatsApp(iosFixture, { title: 'Otta Grätzl & Alltag' })

  it('parses more than 40 messages', () => {
    expect(thread.messages.length).toBeGreaterThan(40)
  })

  it('produces zero messages with an empty ts', () => {
    const empty = thread.messages.filter((m) => m.ts === '')
    expect(empty).toHaveLength(0)
  })

  it('produces a valid ISO string in 2026 or earlier for every message', () => {
    for (const m of thread.messages) {
      const d = new Date(m.ts)
      expect(Number.isNaN(d.getTime())).toBe(false)
      expect(d.getUTCFullYear()).toBeLessThanOrEqual(2026)
    }
  })

  it('finds 3 or more participants', () => {
    expect(thread.participants.length).toBeGreaterThanOrEqual(3)
  })

  it('detects the source as whatsapp-ios', () => {
    expect(thread.source).toBe('whatsapp-ios')
  })

  it('is a group thread and included by default', () => {
    expect(thread.kind).toBe('group')
    expect(thread.included).toBe(true)
  })
})

describe('parseWhatsApp: real Android fixture (seed-corpus-wien-wohnen-android.txt)', () => {
  const thread = parseWhatsApp(androidFixture)

  it('parses without throwing and produces messages', () => {
    expect(thread.messages.length).toBeGreaterThan(0)
  })

  it('detects the source as whatsapp-android', () => {
    expect(thread.source).toBe('whatsapp-android')
  })

  it('normalises the English-locale media placeholder found in this fixture', () => {
    const mediaMsg = thread.messages.find((m) => m.text === '[media omitted]')
    expect(mediaMsg).toBeDefined()
    expect(mediaMsg?.system).toBe(false)
  })

  it('every message has a valid, non-empty ISO timestamp', () => {
    for (const m of thread.messages) {
      expect(m.ts).not.toBe('')
      expect(Number.isNaN(new Date(m.ts).getTime())).toBe(false)
    }
  })
})
