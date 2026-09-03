/**
 * QR wire format: compact JSON serialisation of the three envelope types.
 *
 * `decodeFromQr` is the untrusted-input boundary of the whole demo -- it
 * reads whatever a camera pointed at an arbitrary QR code produced. It must
 * never throw, and it must reject anything that doesn't look exactly like
 * one of the three known envelope shapes (wrong `v`, wrong `t`, missing or
 * mistyped fields).
 */

import type { AnswerEnvelope, ConnectEnvelope, QueryEnvelope } from './types'
import { WIRE_VERSION } from './types'

export type Envelope = ConnectEnvelope | QueryEnvelope | AnswerEnvelope

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
    default:
      return null
  }
}
