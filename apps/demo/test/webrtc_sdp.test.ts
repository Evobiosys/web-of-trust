import { describe, expect, it } from 'vitest'
import {
  decodeRtcWire,
  encodeRtcWire,
  extractTight,
  rebuildSdp,
} from '../src/webrtc_sdp'
import type { TightIceOffer } from '../src/webrtc_sdp'

/** A real Chromium-gathered offer SDP (single host candidate, mDNS
 *  hostname), captured during the feasibility measurement -- see
 *  DEVLOG/result-report-webrtc-ladder.md. Frozen here as a fixture rather
 *  than gathered live: vitest's jsdom environment has no RTCPeerConnection,
 *  and this module's job is the string transform, not ICE itself. */
const REAL_OFFER_SDP = [
  'v=0',
  'o=- 3766725661126223995 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:2175819582 1 udp 2113937151 06337798-40ae-4eea-b3e5-60472aca1e17.local 65069 typ host generation 0 network-cost 999',
  'a=ice-ufrag:jaHK',
  'a=ice-pwd:ERP/+fYbgJGGk4UAnABdwPpM',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 1E:24:E1:9F:8E:80:D1:C2:24:29:CD:DC:A6:AB:45:C3:22:55:76:2A:C4:84:48:C3:2D:D0:1C:77:DD:5B:EB:63',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n')

const REAL_ANSWER_SDP = REAL_OFFER_SDP
  .replace('a=setup:actpass', 'a=setup:active')
  .replace('a=ice-ufrag:jaHK', 'a=ice-ufrag:ggjk')
  .replace('a=ice-pwd:ERP/+fYbgJGGk4UAnABdwPpM', 'a=ice-pwd:UyB7AuEK3QlXLb7u0xiFVB/l')

describe('extractTight', () => {
  it('pulls ufrag/pwd/fingerprint/setup/candidate/sctp fields off a real offer SDP', () => {
    const t = extractTight(REAL_OFFER_SDP)
    expect(t.u).toBe('jaHK')
    expect(t.p).toBe('ERP/+fYbgJGGk4UAnABdwPpM')
    expect(t.s).toBe('actpass')
    expect(t.c).toEqual(['06337798-40ae-4eea-b3e5-60472aca1e17.local:65069'])
    expect(t.m).toBe(5000)
    expect(t.x).toBe(262144)
    // Fingerprint round-trips through base64url without losing bytes -- proven
    // via the round trip test below, not asserted on a literal here (the
    // exact base64url string is an implementation detail, not a contract).
  })

  it('reads setup:active distinctly from setup:actpass -- both start with "act"', () => {
    const t = extractTight(REAL_ANSWER_SDP)
    expect(t.s).toBe('active')
  })

  it('collects every UDP host candidate, ignoring srflx/relay if present', () => {
    const withSrflx = REAL_OFFER_SDP.replace(
      'a=ice-ufrag:jaHK',
      'a=candidate:999 1 udp 1677729535 203.0.113.9 55000 typ srflx raddr 0.0.0.0 rport 0 generation 0\r\na=ice-ufrag:jaHK',
    )
    const t = extractTight(withSrflx)
    expect(t.c).toEqual(['06337798-40ae-4eea-b3e5-60472aca1e17.local:65069'])
  })

  it('throws on an SDP missing required fields rather than producing a garbage QR', () => {
    expect(() => extractTight('v=0\r\ns=-\r\n')).toThrow()
  })

  it('throws when there are zero host candidates', () => {
    const noCand = REAL_OFFER_SDP.split('\r\n').filter((l) => !l.startsWith('a=candidate')).join('\r\n')
    expect(() => extractTight(noCand)).toThrow()
  })
})

describe('extractTight + rebuildSdp round trip', () => {
  it('rebuilds an SDP whose extractTight output matches the original tight payload', () => {
    const original = extractTight(REAL_OFFER_SDP)
    const rebuilt = rebuildSdp(original)
    const reExtracted = extractTight(rebuilt)
    expect(reExtracted).toEqual(original)
  })

  it('preserves the fingerprint exactly (hex-colon -> bytes -> base64url -> bytes -> hex-colon)', () => {
    const original = extractTight(REAL_OFFER_SDP)
    const rebuilt = rebuildSdp(original)
    expect(rebuilt).toContain('a=fingerprint:sha-256 1E:24:E1:9F:8E:80:D1:C2:24:29:CD:DC:A6:AB:45:C3:22:55:76:2A:C4:84:48:C3:2D:D0:1C:77:DD:5B:EB:63')
  })

  it('round-trips a 3-letter setup value (active) as well as actpass', () => {
    const original = extractTight(REAL_ANSWER_SDP)
    const rebuilt = rebuildSdp(original)
    expect(rebuilt).toContain('a=setup:active')
    expect(extractTight(rebuilt).s).toBe('active')
  })

  it('rebuilds every candidate when there is more than one', () => {
    const twoCands = REAL_OFFER_SDP.replace(
      'a=ice-ufrag:jaHK',
      'a=candidate:2175819583 1 udp 2113937150 09999999-40ae-4eea-b3e5-60472aca1e17.local 65070 typ host generation 0 network-cost 999\r\na=ice-ufrag:jaHK',
    )
    const original = extractTight(twoCands)
    expect(original.c).toHaveLength(2)
    const rebuilt = rebuildSdp(original)
    const reExtracted = extractTight(rebuilt)
    expect(reExtracted.c).toEqual(original.c)
  })
})

describe('encodeRtcWire / decodeRtcWire', () => {
  const sample: TightIceOffer = {
    u: 'yRzq',
    p: 'rQUqmYzJN/GXycyj4xe1dXbj',
    f: 'Cfk6bQ3M8dK4r96Tq2Bpwu29UmAJ-VgO3EKo_wi4eu8',
    s: 'actpass',
    c: ['cdbcfb60-9c1d-4d22-844b-ec3d24012ab9.local:63789'],
    m: 5000,
    x: 262144,
  }

  it('round-trips an offer payload', () => {
    const wire = encodeRtcWire('rtc-offer', sample)
    const decoded = decodeRtcWire(wire)
    expect(decoded).toEqual({ t: 'rtc-offer', sdp: sample })
  })

  it('round-trips an answer payload', () => {
    const answer: TightIceOffer = { ...sample, s: 'active' }
    const wire = encodeRtcWire('rtc-answer', answer)
    const decoded = decodeRtcWire(wire)
    expect(decoded).toEqual({ t: 'rtc-answer', sdp: answer })
  })

  it('never throws on garbage input, and returns null', () => {
    expect(decodeRtcWire('not json')).toBeNull()
    expect(decodeRtcWire('{}')).toBeNull()
    expect(decodeRtcWire('{"t":"rtc-offer"}')).toBeNull()
    expect(decodeRtcWire('{"t":"connect","sdp":{}}')).toBeNull()
    expect(decodeRtcWire(JSON.stringify({ t: 'rtc-offer', sdp: { u: 'x' } }))).toBeNull()
    expect(decodeRtcWire(JSON.stringify({ t: 'rtc-offer', sdp: { ...sample, c: [] } }))).toBeNull()
    expect(decodeRtcWire(JSON.stringify({ t: 'rtc-offer', sdp: { ...sample, s: 'bogus' } }))).toBeNull()
  })

  it('does not decode an ordinary wire.ts connect/query/answer envelope as an rtc payload', () => {
    expect(decodeRtcWire(JSON.stringify({ v: 1, t: 'connect', from: { id: 'x', displayName: 'X' }, nonce: 'n' }))).toBeNull()
  })
})

describe('QR-size regression guard -- the whole point of this file', () => {
  it('the tight payload for a realistic 4-candidate offer stays under 400 bytes', () => {
    // Four host candidates approximates a phone with more than one active
    // network interface (see DEVLOG/result-report-webrtc-ladder.md for the
    // real measured QR versions this corresponds to: v14, still below the
    // naive single-candidate encoding's v18).
    const four: TightIceOffer = {
      u: 'yRzq',
      p: 'rQUqmYzJN/GXycyj4xe1dXbj',
      f: 'Cfk6bQ3M8dK4r96Tq2Bpwu29UmAJ-VgO3EKo_wi4eu8',
      s: 'actpass',
      c: [
        'cdbcfb60-9c1d-4d22-844b-ec3d24012ab9.local:63789',
        '11223344-9c1d-4d22-844b-ec3d24012ab9.local:63790',
        '55667788-9c1d-4d22-844b-ec3d24012ab9.local:63791',
        '99aabbcc-9c1d-4d22-844b-ec3d24012ab9.local:63792',
      ],
      m: 5000,
      x: 262144,
    }
    const bytes = new TextEncoder().encode(encodeRtcWire('rtc-offer', four)).length
    expect(bytes).toBeLessThan(400)
  })
})
