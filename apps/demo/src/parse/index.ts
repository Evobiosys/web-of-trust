/**
 * Chat-export entry point: pick the right parser from a filename plus a
 * peek at the content itself, so callers never need to know the export
 * formats' internals.
 */
import type { ChatThread } from '../types'
import { parseWhatsApp } from './whatsapp'
import { parseSignalDesktop } from './signal'
import { parseTelegramJson } from './telegram'

export { parseWhatsApp } from './whatsapp'
export type { ParseWhatsAppOptions } from './whatsapp'
export { parseSignalDesktop } from './signal'
export type { ParseSignalOptions } from './signal'
export { parseTelegramJson } from './telegram'
export type { ParseTelegramOptions } from './telegram'

function looksLikeJsonContent(raw: string): boolean {
  const trimmed = raw.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function isTelegramShape(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const messages = (value as { messages?: unknown }).messages
  if (!Array.isArray(messages) || messages.length === 0) return false
  const first = messages[0] as unknown
  return !!first && typeof first === 'object' && 'id' in first && 'type' in first
}

/**
 * Detects the export format from the filename extension, falling back to
 * content sniffing when the extension alone is ambiguous or missing, and
 * dispatches to the matching parser. Plain-text (.txt or unrecognised
 * text-shaped) input goes to parseWhatsApp, which auto-detects iOS vs
 * Android internally. JSON input is disambiguated between Telegram's
 * documented `{ messages: [{ id, type, ... }] }` shape and the best-effort
 * Signal reader (see signal.ts's UNVERIFIED note).
 */
export function detectAndParse(filename: string, raw: string): ChatThread {
  const lower = filename.toLowerCase()
  const isJsonExt = lower.endsWith('.json')

  if (isJsonExt || looksLikeJsonContent(raw)) {
    let parsed: unknown = null
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      parsed = null
    }
    if (parsed !== null) {
      return isTelegramShape(parsed) ? parseTelegramJson(raw) : parseSignalDesktop(raw)
    }
    // JSON-flavoured filename/content but it didn't actually parse: fall
    // through to parseWhatsApp below, which degrades gracefully (zero
    // messages) rather than throwing.
  }

  return parseWhatsApp(raw)
}
