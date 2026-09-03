/**
 * webrtc_sdp.ts -- the feasibility layer for demo 3.
 *
 * A browser's own `RTCSessionDescription.sdp` is too big for a QR code a
 * phone camera can reliably read once real ICE candidates are on it.
 * Measured against THIS app's own `qrcode` settings (errorCorrectionLevel
 * 'M', see ui/qr.ts) on real Chromium-gathered offers/answers (no STUN/TURN
 * -- host candidates only, the same-WiFi target case):
 *
 *   naive JSON-wrapped raw SDP, 1 host candidate   587 bytes  -> QR v18 (89x89)
 *   naive JSON-wrapped raw SDP, 4 host candidates  974 bytes  -> QR v25 (117x117)
 *   this module's tight encoding, 1 candidate      184 bytes  -> QR v10 (57x57)
 *   this module's tight encoding, 4 candidates     337 bytes  -> QR v14 (73x73)
 *
 * For comparison, the connect-envelope QR this app ALREADY ships and has
 * proven scans reliably on a phone camera is ~312 bytes -> QR v13 (69x69).
 * The naive path is 1.4-2x that version even with a single candidate, and
 * gets rapidly worse with more (every extra active network interface on the
 * phone adds one candidate line). The tight encoding here stays at or
 * below the already-proven size even in a 4-candidate worst case.
 *
 * So: strip to exactly what a datachannel-only offer/answer needs to open a
 * connection, transmit THAT in the QR, and rebuild a spec-shaped SDP string
 * on the receiving side. `extractTight` / `rebuildSdp` below are the two
 * halves of that; round-tripped and verified against a real Chromium
 * `RTCPeerConnection` (`setRemoteDescription` accepts the rebuilt string,
 * both directions) -- see DEVLOG/result-report-webrtc-ladder.md for the
 * measurement session. NOT verified against Safari/WebKit or Firefox in
 * this pass (no such engine available in this environment); the fields
 * kept are all part of the standard datachannel-only O/A (RFC 8839 ICE,
 * RFC 8842 DTLS-SRTP setup, RFC 8841 SCTP-over-DTLS), not a
 * Chromium-specific extension, so cross-engine acceptance is expected but
 * unverified -- flag this if a real cross-browser pairing fails at
 * `setRemoteDescription`.
 *
 * Only UDP host candidates are carried (`typ host`, protocol always
 * `udp`) -- deliberately: this rung's whole claim is "no server in the
 * path", and srflx/relay candidates require a STUN/TURN server this
 * project does not run. A peer behind a NAT that has no direct host-route
 * to the other device (different networks, most mobile-data pairings)
 * will gather host candidates that simply cannot connect to each other;
 * ICE will sit in `checking` and time out. That is not a bug in this
 * encoding, it is rung 2 legitimately not applying -- see webrtc.ts's
 * connect-timeout handling and the ladder's fall-through to rung 3.
 */

export interface TightIceOffer {
  /** ICE username fragment (a=ice-ufrag). */
  u: string
  /** ICE password (a=ice-pwd). */
  p: string
  /** DTLS certificate fingerprint, sha-256, base64url of the 32 raw bytes
   *  (NOT the hex-with-colons form the SDP itself uses -- that alone is
   *  more than half the naive payload's per-candidate cost). */
  f: string
  /** DTLS setup role, verbatim from the SDP: 'actpass' (offer) | 'active' |
   *  'passive' (answer). Kept as the full word, not a single letter --
   *  'active' and 'actpass' share a first letter, so truncating this is a
   *  real correctness bug, not just an abbreviation. */
  s: 'actpass' | 'active' | 'passive'
  /** Host candidates, `${address}:${port}` each. `address` is either a raw
   *  IPv4/IPv6 literal or a browser-minted mDNS `.local` hostname (Chrome's
   *  default privacy behaviour, on by default -- see the module doc). At
   *  least one entry; ICE gathering that produced zero candidates means
   *  this device has no usable network path and rung 2 cannot be offered
   *  at all. */
  c: string[]
  /** SCTP port (a=sctp-port). Chromium's default is 5000, but this is
   *  carried explicitly rather than assumed -- five bytes is cheap
   *  insurance against a future engine default that differs. */
  m: number
  /** Max SCTP message size in bytes (a=max-message-size). Same reasoning. */
  x: number
}

const HOST_CANDIDATE_RE = /^a=candidate:\S+ \d+ udp \d+ (\S+) (\d+) typ host/i

function firstMatch(sdp: string, re: RegExp): string | null {
  const m = re.exec(sdp)
  return m ? m[1] : null
}

/**
 * Extracts the tight payload from a real, browser-produced SDP string
 * (`RTCSessionDescription.sdp`, gathered -- see waitForIceGatheringComplete
 * in webrtc.ts, this must be called only after gathering completes so all
 * host candidates are present). Throws if any required field is missing --
 * a malformed/foreign SDP should never silently produce a garbage QR.
 */
export function extractTight(sdp: string): TightIceOffer {
  const ufrag = firstMatch(sdp, /a=ice-ufrag:(\S+)/)
  const pwd = firstMatch(sdp, /a=ice-pwd:(\S+)/)
  const fpHex = firstMatch(sdp, /a=fingerprint:sha-256 (\S+)/i)
  const setup = firstMatch(sdp, /a=setup:(\S+)/)
  const sctpPortRaw = firstMatch(sdp, /a=sctp-port:(\d+)/)
  const maxMsgRaw = firstMatch(sdp, /a=max-message-size:(\d+)/)

  if (!ufrag || !pwd || !fpHex || !setup) {
    throw new Error('extractTight: SDP is missing ice-ufrag/ice-pwd/fingerprint/setup')
  }
  if (setup !== 'actpass' && setup !== 'active' && setup !== 'passive') {
    throw new Error(`extractTight: unrecognised a=setup value ${setup}`)
  }

  const candidates: string[] = []
  for (const line of sdp.split('\r\n')) {
    const m = HOST_CANDIDATE_RE.exec(line)
    if (m) candidates.push(`${m[1]}:${m[2]}`)
  }
  if (candidates.length === 0) {
    throw new Error('extractTight: no UDP host candidates in SDP -- nothing to offer over this rung')
  }

  const fpBytes = hexColonToBytes(fpHex)
  const f = bytesToBase64Url(fpBytes)

  return {
    u: ufrag,
    p: pwd,
    f,
    s: setup,
    c: candidates,
    m: sctpPortRaw ? Number(sctpPortRaw) : 5000,
    x: maxMsgRaw ? Number(maxMsgRaw) : 262144,
  }
}

/**
 * Inverse of `extractTight`: rebuilds a spec-shaped SDP string a real
 * `RTCPeerConnection.setRemoteDescription` accepts. `type` picks the m-line
 * shape (`offer` always emits `a=setup:${t.s}` verbatim -- callers pass the
 * value they received, this function does not re-derive the role).
 */
export function rebuildSdp(t: TightIceOffer): string {
  const candidateLines = t.c.map((entry, i) => {
    const [addr, port] = splitAddrPort(entry)
    // Foundation and priority are locally-scoped ICE bookkeeping, not
    // security- or connectivity-relevant -- any distinct-per-candidate
    // values work. component=1 (RTP/only component here), generation=0.
    return `a=candidate:${1 + i} 1 udp ${2113937151 - i} ${addr} ${port} typ host generation 0`
  })

  return [
    'v=0',
    `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...candidateLines,
    `a=ice-ufrag:${t.u}`,
    `a=ice-pwd:${t.p}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${bytesToHexColon(base64UrlToBytes(t.f))}`,
    `a=setup:${t.s}`,
    'a=mid:0',
    `a=sctp-port:${t.m}`,
    `a=max-message-size:${t.x}`,
    '',
  ].join('\r\n')
}

function splitAddrPort(entry: string): [string, string] {
  const idx = entry.lastIndexOf(':')
  if (idx < 0) throw new Error(`rebuildSdp: malformed candidate entry "${entry}"`)
  return [entry.slice(0, idx), entry.slice(idx + 1)]
}

// ---------------------------------------------------------------------------
// Small local byte/base64url/hex helpers -- kept here rather than importing
// crypto.ts's, which are shaped around CryptoKey/AEAD use, not raw transcoding.
// ---------------------------------------------------------------------------

function hexColonToBytes(hexColon: string): Uint8Array {
  const clean = hexColon.replace(/:/g, '')
  if (clean.length % 2 !== 0) throw new Error('hexColonToBytes: odd-length hex')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHexColon(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':')
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * JSON-encodes a `TightIceOffer` for the QR/paste payload. A thin wrapper
 * (not just `JSON.stringify`) so the wire tag lives in one place -- see
 * `decodeTightPayload`'s `t` check, which is how a webrtc-offer/-answer code
 * is told apart from an ordinary connect/query/answer QR from wire.ts
 * without touching that module's `Envelope` union at all (kept out of
 * wire.ts on purpose: that union is pinned shut by gate_identity.test.ts and
 * this rung has nothing to do with the privacy contract it protects).
 */
export type RtcWireKind = 'rtc-offer' | 'rtc-answer'

export interface RtcWireMessage {
  t: RtcWireKind
  sdp: TightIceOffer
}

export function encodeRtcWire(kind: RtcWireKind, sdp: TightIceOffer): string {
  const msg: RtcWireMessage = { t: kind, sdp }
  return JSON.stringify(msg)
}

/** Never throws. Returns `null` for anything that is not a well-formed
 *  `RtcWireMessage` -- the same "untrusted input, never throw" contract
 *  wire.ts's `decodeFromQr` uses. */
export function decodeRtcWire(raw: string): RtcWireMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  if (o.t !== 'rtc-offer' && o.t !== 'rtc-answer') return null
  const sdp = o.sdp as Record<string, unknown> | undefined
  if (
    typeof sdp !== 'object' || sdp === null ||
    typeof sdp.u !== 'string' || typeof sdp.p !== 'string' || typeof sdp.f !== 'string' ||
    (sdp.s !== 'actpass' && sdp.s !== 'active' && sdp.s !== 'passive') ||
    !Array.isArray(sdp.c) || sdp.c.length === 0 || !sdp.c.every((x) => typeof x === 'string') ||
    typeof sdp.m !== 'number' || typeof sdp.x !== 'number'
  ) {
    return null
  }
  return { t: o.t, sdp: sdp as unknown as TightIceOffer }
}
