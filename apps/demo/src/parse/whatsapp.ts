/**
 * WhatsApp .txt chat-export parser.
 *
 * Handles both export shapes WhatsApp produces:
 *   iOS:     `[15.08.26, 19:42:11] Marlene: schau ma mal`
 *   Android: `15.08.26, 19:42 - Marlene: schau ma mal`
 *
 * Never throws. Malformed/empty/garbage input degrades to a thread with
 * zero messages so the demo can always render something.
 */
import type { ChatMessage, ChatSource, ChatThread, ThreadKind } from '../types'

export interface ParseWhatsAppOptions {
  /** Explicit thread title. WhatsApp's .txt export never carries the group
   * name inside the file itself -- only the export filename does (WhatsApp
   * names it "WhatsApp Chat with <name>.txt" / "WhatsApp Chat - <name>.txt")
   * -- so the caller should pass the filename-derived name here when known.
   * When absent we fall back to a best-effort heuristic (see deriveTitle). */
  title?: string
}

// ---------------------------------------------------------------------------
// Invisible-character normalisation
// ---------------------------------------------------------------------------

/** U+200E LEFT-TO-RIGHT MARK, U+200F RIGHT-TO-LEFT MARK: bidi rendering
 * artifacts iOS's exporter inserts around brackets, sender names and
 * attachment placeholders. Zero-width, safe to strip anywhere. */
const BIDI_MARKS_RE = /[\u200E\u200F]/g

/** U+202F NARROW NO-BREAK SPACE: appears between a 12-hour time and its
 * AM/PM designator on some locales/exporters. Not zero-width, so we
 * normalise it to a plain space rather than deleting it. */
const NARROW_NBSP_RE = /\u202F/g

function normalizeInvisibles(raw: string): string {
  return raw.replace(NARROW_NBSP_RE, ' ').replace(BIDI_MARKS_RE, '')
}

// ---------------------------------------------------------------------------
// Message-start line detection (iOS vs Android)
// ---------------------------------------------------------------------------

interface LineMatch {
  format: 'whatsapp-ios' | 'whatsapp-android'
  day: number
  month: number
  year: number
  hour: number
  minute: number
  second: number
  rest: string
}

// Seconds optional (iOS usually has them, Android usually doesn't). AM/PM
// optional (12-hour exports exist on some locales even though our seed
// corpora are 24-hour). The narrow no-break space case is already folded
// into a plain space by normalizeInvisibles before these run.
const IOS_LINE_RE =
  /^\[(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp][Mm])?\]\s?(.*)$/
const ANDROID_LINE_RE =
  /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp][Mm])?\s*-\s*(.*)$/

function to24Hour(hour: number, ampm: string | undefined): number {
  if (!ampm) return hour
  const upper = ampm.toUpperCase()
  if (upper === 'PM' && hour !== 12) return hour + 12
  if (upper === 'AM' && hour === 12) return 0
  return hour
}

function buildMatch(format: LineMatch['format'], groups: RegExpExecArray): LineMatch {
  const [, dd, mm, yy, hh, min, sec, ampm, rest] = groups
  let year = parseInt(yy, 10)
  if (yy.length === 2) year += 2000
  return {
    format,
    day: parseInt(dd, 10),
    month: parseInt(mm, 10),
    year,
    hour: to24Hour(parseInt(hh, 10), ampm),
    minute: parseInt(min, 10),
    second: sec ? parseInt(sec, 10) : 0,
    rest,
  }
}

function matchMessageStart(line: string): LineMatch | null {
  const ios = IOS_LINE_RE.exec(line)
  if (ios) return buildMatch('whatsapp-ios', ios)
  const android = ANDROID_LINE_RE.exec(line)
  if (android) return buildMatch('whatsapp-android', android)
  return null
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

/** DD.MM.YY(YY) explicit field parsing -- never handed to `new Date(str)`,
 * which would read it as MM/DD/YY in a US-locale runtime. Produces a plain
 * (timezone-less) ISO-8601 local timestamp, matching ChatMessage.ts's
 * documented contract. */
function toLocalIso(day: number, month: number, year: number, hour: number, minute: number, second: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`
}

// ---------------------------------------------------------------------------
// Author / system-line detection
// ---------------------------------------------------------------------------

const AUTHOR_SEPARATOR = ': '
const URL_LIKE_RE = /:\/\//
const LEADING_TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?\b/

function looksLikeAuthorName(candidate: string): boolean {
  const trimmed = candidate.trim()
  if (trimmed.length === 0 || trimmed.length > 40) return false
  if (trimmed.includes('\n')) return false
  if (URL_LIKE_RE.test(trimmed)) return false
  if (LEADING_TIME_RE.test(trimmed)) return false
  return true
}

interface AuthorSplit {
  author: string
  text: string
  system: boolean
}

/**
 * Splits "Author: message text" from a system notice with no author.
 *
 * Only the FIRST ": " (colon + space) in the line is treated as a candidate
 * separator, and only if what precedes it actually looks like a display
 * name -- this is what keeps a clock time ("19:00: ...") or a URL
 * ("https://example.com: ...") appearing in unauthored text from being
 * mistaken for "Author: ...". A genuine author followed by a message that
 * itself contains a URL or a time (e.g. "Klaus: 19:00 passt") is unaffected
 * because "Klaus: " is found first regardless.
 */
function splitAuthorAndText(rest: string): AuthorSplit {
  const sepIdx = rest.indexOf(AUTHOR_SEPARATOR)
  if (sepIdx === -1) {
    return { author: '', text: rest.trim(), system: true }
  }
  const candidate = rest.slice(0, sepIdx)
  if (!looksLikeAuthorName(candidate)) {
    return { author: '', text: rest.trim(), system: true }
  }
  return { author: candidate.trim(), text: rest.slice(sepIdx + AUTHOR_SEPARATOR.length), system: false }
}

// ---------------------------------------------------------------------------
// Media / deleted / edited placeholder normalisation
// ---------------------------------------------------------------------------

const MEDIA_PLACEHOLDERS: Array<[RegExp, string]> = [
  [/^<Medien ausgeschlossen>$/i, '[media omitted]'],
  [/^<Media omitted>$/i, '[media omitted]'],
  [/^Bild weggelassen$/i, '[media omitted]'],
  [/^<?Bild ausgeschlossen>?$/i, '[media omitted]'],
  [/^audio omitted$/i, '[audio omitted]'],
  [/^<Audio omitted>$/i, '[audio omitted]'],
  [/^Sticker weggelassen$/i, '[sticker omitted]'],
]

function normalizeMediaPlaceholder(text: string): { text: string; matched: boolean } {
  const trimmed = text.trim()
  for (const [pattern, replacement] of MEDIA_PLACEHOLDERS) {
    if (pattern.test(trimmed)) return { text: replacement, matched: true }
  }
  return { text, matched: false }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface PendingMessage {
  ts: string
  author: string
  text: string
  system: boolean
}

function finalizeMessage(pending: PendingMessage): ChatMessage {
  const { text: normalizedText, matched } = normalizeMediaPlaceholder(pending.text)
  if (matched) {
    // Deleted/edited markers (rule 7) and other free text fall through
    // untouched below; only recognised media placeholders are rewritten,
    // and always as non-system (a real participant sent real content, it
    // just isn't text WhatsApp exported).
    return { ts: pending.ts, author: pending.author, text: normalizedText, system: false }
  }
  return { ts: pending.ts, author: pending.author, text: pending.text.trim(), system: pending.system }
}

const GROUP_CREATED_RE = /hat die Gruppe\s+"([^"]+)"\s+erstellt\.?$/i

function makeId(prefix: string, messages: ChatMessage[]): string {
  const seed = `${prefix}:${messages.length}:${messages[0]?.ts ?? ''}:${messages[messages.length - 1]?.ts ?? ''}`
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return `${prefix}-${Math.abs(hash).toString(36)}`
}

function deriveTitle(
  opts: ParseWhatsAppOptions,
  kind: ThreadKind,
  participants: string[],
  groupNameFromContent: string | null,
): string {
  if (opts.title) return opts.title
  if (groupNameFromContent) return groupNameFromContent
  if (kind === 'direct') return participants.join(' & ') || 'WhatsApp-Chat'
  if (participants.length === 0) return 'WhatsApp-Chat'
  const shown = participants.slice(0, 3).join(', ')
  return participants.length > 3 ? `Gruppe: ${shown} u.a.` : `Gruppe: ${shown}`
}

export function parseWhatsApp(raw: string, opts: ParseWhatsAppOptions = {}): ChatThread {
  const messages: ChatMessage[] = []
  let detectedSource: ChatSource | null = null
  let groupNameFromContent: string | null = null

  if (raw) {
    const normalized = normalizeInvisibles(raw)
    const lines = normalized.split(/\r\n|\r|\n/)

    let current: PendingMessage | null = null
    const flush = () => {
      if (current) {
        messages.push(finalizeMessage(current))
        current = null
      }
    }

    for (const line of lines) {
      const match = matchMessageStart(line)
      if (match) {
        flush()
        if (!detectedSource) detectedSource = match.format
        if (!groupNameFromContent) {
          const groupMatch = GROUP_CREATED_RE.exec(match.rest)
          if (groupMatch) groupNameFromContent = groupMatch[1]
        }
        const ts = toLocalIso(match.day, match.month, match.year, match.hour, match.minute, match.second)
        const { author, text, system } = splitAuthorAndText(match.rest)
        current = { ts, author, text, system }
      } else if (current) {
        // Rule 1: a message continues until the next line that starts with
        // a timestamp. Join continuation lines with '\n'. Lines seen before
        // any timestamp has matched at all are unparseable leading noise
        // and are intentionally dropped (never thrown on).
        current.text = current.text.length > 0 ? `${current.text}\n${line}` : line
      }
    }
    flush()
  }

  const participants = Array.from(
    new Set(messages.filter((m) => !m.system && m.author.trim() !== '').map((m) => m.author)),
  )
  // Exactly 2 distinct non-system authors => direct. 3+ => group. 0 or 1
  // (empty export, or a monologue/self-chat) bucket to 'group' so the
  // opt-in-only-for-direct product rule (see ChatThread.included) never
  // silently hides an ambiguous thread -- included defaults true.
  const kind: ThreadKind = participants.length === 2 ? 'direct' : 'group'
  const included = kind !== 'direct'
  const source: ChatSource = detectedSource ?? 'whatsapp-ios'
  const title = deriveTitle(opts, kind, participants, groupNameFromContent)

  return {
    id: makeId('whatsapp', messages),
    title,
    kind,
    participants,
    messages,
    source,
    included,
  }
}
