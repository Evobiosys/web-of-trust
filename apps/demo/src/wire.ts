/**
 * QR wire format: compact JSON serialisation of the three envelope types.
 *
 * `decodeFromQr` is the untrusted-input boundary of the whole demo -- it
 * reads whatever a camera pointed at an arbitrary QR code produced. It must
 * never throw, and it must reject anything that doesn't look exactly like
 * one of the three known envelope shapes (wrong `v`, wrong `t`, missing or
 * mistyped fields).
 */

import type { AnswerEnvelope, ChatEnvelope, ConnectEnvelope, PingEnvelope, QueryEnvelope } from './types'
import { WIRE_VERSION } from './types'

/** Free text is the one unbounded field on the wire, so it gets a bound. */
export const CHAT_MAX_LEN = 500

export type Envelope = ConnectEnvelope | QueryEnvelope | AnswerEnvelope | ChatEnvelope | PingEnvelope

/** JSON-serialise an envelope for a QR code. */
export function encodeForQr(env: Envelope): string {
  return JSON.stringify(env)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isIdentity(v: unknown): v is { id: string; displayName: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    isNonEmptyString((v as Record<string, unknown>).id) &&
    typeof (v as Record<string, unknown>).displayName === 'string'
  )
}

function parseConnect(o: Record<string, unknown>): ConnectEnvelope | null {
  if (!isIdentity(o.from)) return null
  if (!isNonEmptyString(o.nonce)) return null
  // `did` is OPTIONAL (relay mode only, see types.ts's doc comment) -- absent
  // entirely is fine (a demo-1/qr-mode code). But if the KEY is present at
  // all, it must be a non-empty string or the whole envelope is rejected,
  // same strictness as every other field here: a malformed-but-present field
  // is a sign of tampering or a version skew, not something to silently drop.
  if ('did' in o && !isNonEmptyString(o.did)) return null
  const did = isNonEmptyString(o.did) ? o.did : undefined
  return { v: WIRE_VERSION, t: 'connect', from: o.from, nonce: o.nonce, ...(did ? { did } : {}) }
}

function parseQuery(o: Record<string, unknown>): QueryEnvelope | null {
  if (!isIdentity(o.from)) return null
  if (!isNonEmptyString(o.templateId)) return null
  if (typeof o.templateVersion !== 'number' || !Number.isFinite(o.templateVersion)) return null
  if (!isNonEmptyString(o.qid)) return null
  if (typeof o.issuedAt !== 'number' || !Number.isFinite(o.issuedAt)) return null
  return {
    v: WIRE_VERSION,
    t: 'query',
    from: o.from,
    templateId: o.templateId,
    templateVersion: o.templateVersion,
    qid: o.qid,
    issuedAt: o.issuedAt,
  }
}

function parseAnswer(o: Record<string, unknown>): AnswerEnvelope | null {
  if (!isNonEmptyString(o.qid)) return null
  if (typeof o.body !== 'string') return null
  return { v: WIRE_VERSION, t: 'answer', qid: o.qid, body: o.body }
}

function parseChat(o: Record<string, unknown>): ChatEnvelope | null {
  if (!isIdentity(o.from)) return null
  // An empty message is not a message. A caller that wants to say nothing can
  // simply not send.
  if (!isNonEmptyString(o.text)) return null
  // Bound it here, at the boundary, rather than trusting a sender's restraint:
  // this is the one envelope whose content is free text.
  if (o.text.length > CHAT_MAX_LEN) return null
  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts)) return null
  return { v: WIRE_VERSION, t: 'chat', from: o.from, text: o.text, ts: o.ts }
}

function parsePing(o: Record<string, unknown>): PingEnvelope | null {
  if (!isNonEmptyString(o.id)) return null
  if (typeof o.back !== 'boolean') return null
  return { v: WIRE_VERSION, t: 'ping', id: o.id, back: o.back }
}

/**
 * Parse a QR payload back into an envelope. Returns `null` on anything
 * malformed -- truncated JSON, wrong version, wrong/missing `t`, wrong field
 * types -- never throws.
 */
export function decodeFromQr(s: string): Envelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(s)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>

  if (o.v !== WIRE_VERSION) return null

  switch (o.t) {
    case 'connect':
      return parseConnect(o)
    case 'query':
      return parseQuery(o)
    case 'answer':
      return parseAnswer(o)
    case 'chat':
      return parseChat(o)
    case 'ping':
      return parsePing(o)
    default:
      return null
  }
}
