/**
 * Signal Desktop chat parser.
 *
 * VERIFIED FACT (WebFetch against github.com/carderne/signal-export's
 * README, 2026-09-01): Signal Desktop ships no first-party plaintext chat
 * export, and the community tool this task named as "the JSON/CSV format"
 * -- signal-export -- does not actually produce JSON or CSV. It emits
 * Markdown/HTML, with a line shape structurally identical to WhatsApp's own
 * export: `[2019-05-29, 15:04] Me: How is everyone?`. No JSON- or
 * CSV-producing Signal Desktop export tool was found and confirmed.
 *
 * UNVERIFIED: because no real JSON export sample exists to parse against,
 * the reader below is a best-effort, defensively-coded reader for a
 * generic "array of message-like objects" shape (the kind a local
 * DB-dump/backup-viewer script might plausibly emit: some mix of
 * body/text, author/sender/from/source, timestamp/date/sent_at). This
 * shape is NOT confirmed against any real tool's output -- treat it as a
 * placeholder pending a real sample, not as a documented format. If a real
 * signal-export Markdown sample ever needs parsing instead, it would reuse
 * whatsapp.ts's line-matching logic (same shape), not this file.
 */
import type { ChatMessage, ChatThread, ThreadKind } from '../types'

export interface ParseSignalOptions {
  title?: string
}

interface SignalMessageGuess {
  body?: string
  text?: string
  source?: string
  author?: string
  sender?: string
  from?: string
  timestamp?: number | string
  date?: string
  sent_at?: number
  /** e.g. 'incoming' | 'outgoing' | 'group-update' | 'call-history' | ... */
  type?: string
}

// System-ish event types a hypothetical export might use. Names are guesses
// (see the UNVERIFIED note above), kept narrow on purpose: an unrecognised
// `type` value is treated as a normal message, never silently as system.
const SYSTEM_TYPES = new Set(['group-update', 'call-history', 'profile-change', 'verified-change', 'keychange'])

function firstDefined<T>(...values: Array<T | undefined | null>): T | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

function normalizeSignalTimestamp(m: SignalMessageGuess): string {
  const raw = firstDefined(m.timestamp, m.sent_at, m.date)
  if (raw === undefined) return ''
  if (typeof raw === 'number') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? '' : d.toISOString()
  }
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) {
    const d = new Date(Number(trimmed))
    return Number.isNaN(d.getTime()) ? '' : d.toISOString()
  }
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function extractRawMessages(data: unknown): SignalMessageGuess[] {
  if (Array.isArray(data)) return data as SignalMessageGuess[]
  if (data && typeof data === 'object') {
    const maybeMessages = (data as { messages?: unknown }).messages
    if (Array.isArray(maybeMessages)) return maybeMessages as SignalMessageGuess[]
  }
  return []
}

function parseSignalJson(raw: string): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Deterministic, dependency-free id -- see whatsapp.ts for the same helper;
// duplicated rather than shared to keep this file's ownership self-contained.
function makeId(prefix: string, messages: ChatMessage[]): string {
  const seed = `${prefix}:${messages.length}:${messages[0]?.ts ?? ''}:${messages[messages.length - 1]?.ts ?? ''}`
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return `${prefix}-${Math.abs(hash).toString(36)}`
}

export function parseSignalDesktop(raw: string, opts: ParseSignalOptions = {}): ChatThread {
  const data = parseSignalJson(raw)
  const rawMessages = extractRawMessages(data)

  const messages: ChatMessage[] = rawMessages.map((m) => {
    const system = m.type ? SYSTEM_TYPES.has(m.type) : false
    return {
      ts: normalizeSignalTimestamp(m),
      author: firstDefined(m.author, m.sender, m.from, m.source) ?? '',
      text: firstDefined(m.body, m.text) ?? '',
      system,
    }
  })

  const participants = Array.from(
    new Set(messages.filter((m) => !m.system && m.author.trim() !== '').map((m) => m.author)),
  )
  const kind: ThreadKind = participants.length === 2 ? 'direct' : 'group'
  const included = kind !== 'direct'
  const title = opts.title ?? (kind === 'direct' ? participants.join(' & ') : 'Signal-Chat')

  return {
    id: makeId('signal', messages),
    title,
    kind,
    participants,
    messages,
    source: 'signal-desktop',
    included,
  }
}
