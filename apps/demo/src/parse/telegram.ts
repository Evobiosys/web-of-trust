/**
 * Telegram Desktop JSON chat-export parser.
 *
 * Shape (Telegram Desktop 11.0+, "Export chat history" -> JSON), documented
 * at core.telegram.org/import-export:
 *   { name, type, id, messages: [{ id, type, date, from, text }, ...] }
 *
 * `text` is a string for plain messages, but Telegram splits formatted
 * messages (bold/links/mentions/etc.) into an array whose entries are
 * either a plain string or `{ type, text }`; both shapes are flattened here.
 * `type: "service"` messages (joins, title changes, pinned, ...) have no
 * real `from` in general and are marked `system: true`.
 *
 * Never throws: invalid JSON or an unexpected shape degrades to a thread
 * with zero messages.
 */
import type { ChatMessage, ChatThread, ThreadKind } from '../types'

// Deterministic, dependency-free id -- deliberately not crypto.randomUUID()
// so parses are reproducible in tests. Duplicated (not shared) across the
// three parser modules to keep each file's ownership self-contained.
function makeId(prefix: string, messages: ChatMessage[]): string {
  const seed = `${prefix}:${messages.length}:${messages[0]?.ts ?? ''}:${messages[messages.length - 1]?.ts ?? ''}`
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return `${prefix}-${Math.abs(hash).toString(36)}`
}

export interface ParseTelegramOptions {
  title?: string
}

type TelegramTextFragment = string | { type?: string; text?: string }
type TelegramText = string | TelegramTextFragment[]

interface TelegramMessageRaw {
  id?: number
  type?: string // 'message' | 'service'
  date?: string // already ISO-shaped, e.g. "2026-08-15T19:42:11"
  date_unixtime?: string
  from?: string
  actor?: string // service messages sometimes name the actor instead of 'from'
  text?: TelegramText
}

interface TelegramExportRaw {
  name?: string
  type?: string
  id?: number
  messages?: TelegramMessageRaw[]
}

function flattenTelegramText(text: TelegramText | undefined): string {
  if (typeof text === 'string') return text
  if (!Array.isArray(text)) return ''
  return text.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
}

function normalizeTelegramDate(date: string | undefined, unixtime: string | undefined): string {
  if (date && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(date)) return date
  if (unixtime !== undefined) {
    const ms = Number(unixtime) * 1000
    if (!Number.isNaN(ms)) return new Date(ms).toISOString()
  }
  return date ?? ''
}

function parseTelegramExport(raw: string): TelegramExportRaw | null {
  if (!raw) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (data && typeof data === 'object') return data as TelegramExportRaw
    return null
  } catch {
    return null
  }
}

export function parseTelegramJson(raw: string, opts: ParseTelegramOptions = {}): ChatThread {
  const data = parseTelegramExport(raw)
  const rawMessages = Array.isArray(data?.messages) ? (data!.messages as TelegramMessageRaw[]) : []

  const messages: ChatMessage[] = rawMessages.map((rm) => {
    const system = rm.type === 'service'
    const author = (system ? rm.actor ?? rm.from : rm.from) ?? ''
    return {
      ts: normalizeTelegramDate(rm.date, rm.date_unixtime),
      author,
      text: flattenTelegramText(rm.text),
      system,
    }
  })

  const participants = Array.from(
    new Set(messages.filter((m) => !m.system && m.author.trim() !== '').map((m) => m.author)),
  )
  const kind: ThreadKind = participants.length === 2 ? 'direct' : 'group'
  const included = kind !== 'direct'
  const title = opts.title ?? data?.name ?? (kind === 'direct' ? participants.join(' & ') : 'Telegram-Chat')

  return {
    id: makeId('telegram', messages),
    title,
    kind,
    participants,
    messages,
    source: 'telegram-json',
    included,
  }
}
