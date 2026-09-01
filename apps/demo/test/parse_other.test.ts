import { describe, it, expect } from 'vitest'
import { parseTelegramJson } from '../src/parse/telegram'
import { parseSignalDesktop } from '../src/parse/signal'
import { detectAndParse, parseWhatsApp } from '../src/parse/index'

describe('parseTelegramJson', () => {
  const telegramExport = {
    name: 'Otta Grätzl & Alltag',
    type: 'private_group',
    id: 123456,
    messages: [
      { id: 1, type: 'service', date: '2026-08-15T08:03:12', actor: 'Marlene', action: 'create_group', text: '' },
      { id: 2, type: 'message', date: '2026-08-15T08:15:44', from: 'Marlene', text: 'servas allerseits' },
      {
        id: 3,
        type: 'message',
        date: '2026-08-15T08:22:10',
        from: 'Basti',
        text: [
          'passt, ',
          { type: 'bold', text: 'endlich' },
          '! schau ',
          { type: 'link', text: 'https://example.com' },
        ],
      },
      { id: 4, type: 'message', date: '2026-08-15T08:41:33', from: 'Fatima', text: 'hi zsm' },
    ],
  }

  it('parses text given as a plain string', () => {
    const thread = parseTelegramJson(JSON.stringify(telegramExport))
    const hi = thread.messages.find((m) => m.author === 'Marlene' && !m.system)
    expect(hi?.text).toBe('servas allerseits')
  })

  it('parses text given as an array of string and {type,text} fragments, flattening them', () => {
    const thread = parseTelegramJson(JSON.stringify(telegramExport))
    const basti = thread.messages.find((m) => m.author === 'Basti')
    expect(basti?.text).toBe('passt, endlich! schau https://example.com')
  })

  it('marks type: "service" messages as system: true', () => {
    const thread = parseTelegramJson(JSON.stringify(telegramExport))
    expect(thread.messages[0]).toMatchObject({ system: true })
  })

  it('derives kind "group" and included=true for three or more senders', () => {
    const thread = parseTelegramJson(JSON.stringify(telegramExport))
    expect(thread.kind).toBe('group')
    expect(thread.included).toBe(true)
    expect(thread.participants.sort()).toEqual(['Basti', 'Fatima', 'Marlene'])
  })

  it('derives kind "direct" and included=false for exactly two senders', () => {
    const direct = {
      messages: [
        { id: 1, type: 'message', date: '2026-08-15T08:15:44', from: 'Klaus', text: 'hi' },
        { id: 2, type: 'message', date: '2026-08-15T08:16:00', from: 'Marlene', text: 'hi zurück' },
      ],
    }
    const thread = parseTelegramJson(JSON.stringify(direct))
    expect(thread.kind).toBe('direct')
    expect(thread.included).toBe(false)
  })

  it('uses the export\'s top-level "name" as the title when opts.title is absent', () => {
    const thread = parseTelegramJson(JSON.stringify(telegramExport))
    expect(thread.title).toBe('Otta Grätzl & Alltag')
  })

  it('sets source to "telegram-json"', () => {
    const thread = parseTelegramJson(JSON.stringify(telegramExport))
    expect(thread.source).toBe('telegram-json')
  })

  it('returns zero messages for invalid JSON, and never throws', () => {
    expect(() => parseTelegramJson('{ not valid json')).not.toThrow()
    const thread = parseTelegramJson('{ not valid json')
    expect(thread.messages).toHaveLength(0)
  })

  it('returns zero messages for empty input', () => {
    const thread = parseTelegramJson('')
    expect(thread.messages).toHaveLength(0)
  })

  it('returns zero messages when "messages" is missing or not an array', () => {
    const thread = parseTelegramJson(JSON.stringify({ name: 'x', type: 'personal_chat' }))
    expect(thread.messages).toHaveLength(0)
  })
})

describe('parseSignalDesktop (best-effort, UNVERIFIED shape -- see signal.ts)', () => {
  const guessedExport = [
    { body: 'servas allerseits', sender: 'Marlene', timestamp: 1786000000000, type: 'outgoing' },
    { text: 'passt, endlich', from: 'Basti', timestamp: 1786000100000, type: 'incoming' },
    { body: '', author: 'Marlene', timestamp: 1786000200000, type: 'group-update' },
  ]

  it('reads body/sender/timestamp style fields from a top-level array', () => {
    const thread = parseSignalDesktop(JSON.stringify(guessedExport))
    expect(thread.messages[0]).toMatchObject({ author: 'Marlene', text: 'servas allerseits', system: false })
  })

  it('falls back through text/from when body/sender are absent', () => {
    const thread = parseSignalDesktop(JSON.stringify(guessedExport))
    expect(thread.messages[1]).toMatchObject({ author: 'Basti', text: 'passt, endlich' })
  })

  it('maps a recognised system-ish type (e.g. "group-update") to system: true', () => {
    const thread = parseSignalDesktop(JSON.stringify(guessedExport))
    expect(thread.messages[2].system).toBe(true)
  })

  it('also accepts a { messages: [...] } wrapper object, not just a bare array', () => {
    const thread = parseSignalDesktop(JSON.stringify({ messages: guessedExport }))
    expect(thread.messages).toHaveLength(3)
  })

  it('produces a valid ISO timestamp from a numeric epoch-ms timestamp field', () => {
    const thread = parseSignalDesktop(JSON.stringify(guessedExport))
    expect(Number.isNaN(new Date(thread.messages[0].ts).getTime())).toBe(false)
  })

  it('sets source to "signal-desktop"', () => {
    const thread = parseSignalDesktop(JSON.stringify(guessedExport))
    expect(thread.source).toBe('signal-desktop')
  })

  it('returns zero messages for invalid JSON, and never throws', () => {
    expect(() => parseSignalDesktop('not json at all')).not.toThrow()
    const thread = parseSignalDesktop('not json at all')
    expect(thread.messages).toHaveLength(0)
  })

  it('returns zero messages for empty input', () => {
    const thread = parseSignalDesktop('')
    expect(thread.messages).toHaveLength(0)
  })
})

describe('detectAndParse', () => {
  it('routes a .txt filename with iOS-shaped content to the WhatsApp parser', () => {
    const thread = detectAndParse('WhatsApp Chat.txt', '[15.08.26, 19:42:11] Marlene: schau ma mal')
    expect(thread.source).toBe('whatsapp-ios')
    expect(thread.messages[0].author).toBe('Marlene')
  })

  it('routes a .txt filename with Android-shaped content to the WhatsApp parser', () => {
    const thread = detectAndParse('chat.txt', '15.08.26, 19:42 - Marlene: schau ma mal')
    expect(thread.source).toBe('whatsapp-android')
  })

  it('routes a Telegram-shaped result.json to the Telegram parser', () => {
    const telegramLike = JSON.stringify({
      name: 'Grätzl',
      messages: [{ id: 1, type: 'message', date: '2026-08-15T08:15:44', from: 'Marlene', text: 'hi' }],
    })
    const thread = detectAndParse('result.json', telegramLike)
    expect(thread.source).toBe('telegram-json')
  })

  it('routes a non-Telegram-shaped .json to the Signal (best-effort) parser', () => {
    const genericJson = JSON.stringify([{ body: 'hi', sender: 'Marlene', timestamp: 1786000000000 }])
    const thread = detectAndParse('export.json', genericJson)
    expect(thread.source).toBe('signal-desktop')
  })

  it('sniffs JSON content even without a .json extension', () => {
    const telegramLike = JSON.stringify({
      messages: [{ id: 1, type: 'message', date: '2026-08-15T08:15:44', from: 'Marlene', text: 'hi' }],
    })
    const thread = detectAndParse('export', telegramLike)
    expect(thread.source).toBe('telegram-json')
  })

  it('falls back to the WhatsApp parser for an unrecognised extension with chat-shaped text', () => {
    const thread = detectAndParse('export.log', '[15.08.26, 19:42:11] Marlene: schau ma mal')
    expect(thread.source).toBe('whatsapp-ios')
  })

  it('never throws on empty input regardless of filename', () => {
    expect(() => detectAndParse('anything.json', '')).not.toThrow()
    expect(() => detectAndParse('anything.txt', '')).not.toThrow()
  })

  it('re-exports parseWhatsApp directly for callers that already know the format', () => {
    const thread = parseWhatsApp('[15.08.26, 19:42:11] Marlene: schau ma mal')
    expect(thread.messages).toHaveLength(1)
  })
})
