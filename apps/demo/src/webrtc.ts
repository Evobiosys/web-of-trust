/**
 * webrtc.ts -- rung 2: a WebRTC data channel, no server anywhere in the
 * path. Signalling (the SDP offer/answer exchange that a server usually
 * carries) travels as two QR codes instead -- see webrtc_sdp.ts for why
 * that fits and what has to be stripped to make it fit.
 *
 * WHAT THIS RUNG PROVES, PRECISELY (read before reusing this claim
 * anywhere): once the data channel is open, envelopes travel
 * device-to-device over UDP with no relay, no ingress, nothing at
 * questhub.eco or anywhere else in the path -- a stronger claim than demo
 * 2's "the server cannot read it", because here there IS no server. The
 * channel itself is DTLS-encrypted (mandatory for WebRTC data channels),
 * keyed by the certificate fingerprint each side put in its QR code.
 *
 * WHAT THIS DOES **NOT** PROVE:
 *  - The fingerprint arrives over the SAME QR-in-the-room channel demo 1's
 *    `derivePairKey` does, and inherits the identical caveat (crypto.ts's
 *    SECURITY NOTE): anyone who saw both QR codes during the ceremony can
 *    impersonate either side. This is not an authenticated key exchange in
 *    the PKI sense, only "whoever was in the room".
 *  - ICE reveals real network information to the peer: each side learns
 *    the other's local IP address (or, with Chrome's default mDNS privacy
 *    behaviour, a per-session random `.local` hostname that still lets the
 *    peer resolve and connect to that address on the LAN -- see
 *    webrtc_sdp.ts's doc comment). An observer on the SAME Wi-Fi can see
 *    the DTLS/SCTP flow between the two devices' local addresses -- its
 *    timing and packet sizes, though not its content (DTLS keys are
 *    exchanged inside the encrypted handshake, not visible on the wire in
 *    a form the QR-only observer without the fingerprint could use).
 *  - No STUN/TURN server is configured (this project runs neither), so
 *    only directly-reachable host candidates are ever gathered. Two
 *    devices on different networks, or on the same Wi-Fi with client/AP
 *    isolation enabled (common on guest and public networks), will not
 *    connect at all. That is this rung legitimately not applying, not a
 *    bug -- see CONNECT_TIMEOUT_MS below and the ladder's fall-through.
 *  - `gate.ts`'s consent gate, the k-anonymity floor, and the
 *    byte-identical PASS/shared envelope apply exactly as on every other
 *    rung -- this file only ever moves already-built `Envelope` JSON
 *    strings, the same objects `wire.ts#encodeForQr`/`decodeFromQr`
 *    produce and parse for demo 1, over a different pipe. It does not
 *    decide anything about what gets sent.
 */
import type { Envelope } from './wire'
import { decodeFromQr, encodeForQr } from './wire'
import { decodeRtcWire, encodeRtcWire, extractTight, rebuildSdp } from './webrtc_sdp'
import type { TightIceOffer } from './webrtc_sdp'

/**
 * No STUN/TURN configured anywhere in this project -- see the module doc.
 * Passing an empty ICE server list is what keeps ICE gathering to host
 * candidates only, which is what webrtc_sdp.ts's size measurement assumes.
 */
const ICE_SERVERS: RTCIceServer[] = []

/** Generous cap on ICE candidate gathering. Real measurement (see
 *  DEVLOG/result-report-webrtc-ladder.md): gathering completed in well
 *  under 100ms on every one of 50 sampled runs on a single-NIC machine.
 *  This is a ceiling for a worse network stack, not the expected wait. */
const GATHER_TIMEOUT_MS = 4_000

/** How long to wait, after both descriptions are set, for the data channel
 *  to actually open before declaring this rung failed and telling the
 *  caller to offer the server fallback. Chosen with headroom over the
 *  gathering budget above, not measured against a real cross-device
 *  connect (see the report's "not verified" section) -- same-Wi-Fi ICE
 *  connectivity checks are typically sub-second when a direct route
 *  exists, so 10s is "clearly hung", not "still might work". */
export const CONNECT_TIMEOUT_MS = 10_000

export type WebrtcStatus =
  | 'idle'
  | 'gathering-offer'
  | 'awaiting-answer'
  | 'gathering-answer'
  | 'connecting'
  | 'open'
  | 'failed'
  | 'closed'

export interface WebrtcChannel {
  status(): WebrtcStatus
  onStatus(cb: (status: WebrtcStatus) => void): void
  onEnvelope(cb: (envelope: Envelope) => void): void
  /** True once the data channel is open and `send` will actually go over the wire. */
  isOpen(): boolean
  /** Sends an envelope over the open data channel. Throws if not open --
   *  callers (main.ts) check `isOpen()` / catch and fall back, exactly the
   *  same shape as `RelayChannel.send`'s failure handling. */
  send(envelope: Envelope): void
  close(): void
}

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', onChange)
        clearTimeout(timer)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', onChange)
    const timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve() // whatever candidates gathered so far are used -- see GATHER_TIMEOUT_MS's doc.
    }, GATHER_TIMEOUT_MS)
  })
}

class WebrtcChannelImpl implements WebrtcChannel {
  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private st: WebrtcStatus = 'idle'
  private statusCb: ((status: WebrtcStatus) => void) | null = null
  private envelopeCb: ((envelope: Envelope) => void) | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.pc.addEventListener('iceconnectionstatechange', () => {
      const s = this.pc.iceConnectionState
      if ((s === 'failed' || s === 'closed') && this.st !== 'open') {
        this.setStatus('failed')
      }
      // 'disconnected' after having been open is a real network drop worth
      // surfacing (the ladder mode listens for exactly this), but is not
      // itself modelled as a WebrtcStatus here -- main.ts's ladder wiring
      // treats any post-open failure the same way, via isOpen() going false
      // once the data channel itself closes.
    })
  }

  status(): WebrtcStatus { return this.st }
  private setStatus(s: WebrtcStatus): void {
    this.st = s
    this.statusCb?.(s)
  }
  onStatus(cb: (status: WebrtcStatus) => void): void { this.statusCb = cb }
  onEnvelope(cb: (envelope: Envelope) => void): void { this.envelopeCb = cb }
  isOpen(): boolean { return this.dc?.readyState === 'open' }

  send(envelope: Envelope): void {
    if (this.dc?.readyState !== 'open') throw new Error('WebrtcChannel.send: data channel not open')
    this.dc.send(encodeForQr(envelope))
  }

  close(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.dc?.close()
    this.pc.close()
    this.setStatus('closed')
  }

  private wireDataChannel(dc: RTCDataChannel): void {
    this.dc = dc
    dc.addEventListener('open', () => {
      if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null }
      this.setStatus('open')
    })
    dc.addEventListener('close', () => {
      if (this.st === 'open') this.setStatus('failed')
    })
    dc.addEventListener('message', (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return
      const env = decodeFromQr(ev.data)
      if (env) this.envelopeCb?.(env)
    })
  }

  private armConnectTimeout(): void {
    this.connectTimer = setTimeout(() => {
      if (this.st !== 'open') this.setStatus('failed')
    }, CONNECT_TIMEOUT_MS)
  }

  /** Offerer side: create the data channel, gather ICE, return the tight
   *  offer payload to render as a QR. */
  async createOffer(): Promise<TightIceOffer> {
    this.setStatus('gathering-offer')
    const dc = this.pc.createDataChannel('wot')
    this.wireDataChannel(dc)
    await this.pc.setLocalDescription(await this.pc.createOffer())
    await waitForIceGatheringComplete(this.pc)
    if (!this.pc.localDescription) throw new Error('createOffer: no local description after gathering')
    const tight = extractTight(this.pc.localDescription.sdp)
    this.setStatus('awaiting-answer')
    return tight
  }

  /** Offerer side, second half: consume the scanned-back answer and start
   *  waiting for the channel to open. */
  async acceptAnswer(answer: TightIceOffer): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp: rebuildSdp(answer) })
    this.setStatus('connecting')
    this.armConnectTimeout()
  }

  /** Answerer side: consume the scanned offer, produce the tight answer
   *  payload to render as a QR, and start waiting for the channel to open
   *  (the answerer does not need a further round trip -- ICE connectivity
   *  checks proceed as soon as both descriptions are set). */
  async acceptOffer(offer: TightIceOffer): Promise<TightIceOffer> {
    this.pc.addEventListener('datachannel', (ev: RTCDataChannelEvent) => {
      this.wireDataChannel(ev.channel)
    })
    await this.pc.setRemoteDescription({ type: 'offer', sdp: rebuildSdp(offer) })
    this.setStatus('gathering-answer')
    await this.pc.setLocalDescription(await this.pc.createAnswer())
    await waitForIceGatheringComplete(this.pc)
    if (!this.pc.localDescription) throw new Error('acceptOffer: no local description after gathering')
    const tight = extractTight(this.pc.localDescription.sdp)
    this.setStatus('connecting')
    this.armConnectTimeout()
    return tight
  }
}

export function createWebrtcChannel(): WebrtcChannel & {
  createOffer: () => Promise<TightIceOffer>
  acceptAnswer: (answer: TightIceOffer) => Promise<void>
  acceptOffer: (offer: TightIceOffer) => Promise<TightIceOffer>
} {
  return new WebrtcChannelImpl()
}

/** QR/paste payload helpers -- thin re-exports so main.ts imports one
 *  module for the whole rung 2 ceremony. */
export function encodeOfferPayload(sdp: TightIceOffer): string { return encodeRtcWire('rtc-offer', sdp) }
export function encodeAnswerPayload(sdp: TightIceOffer): string { return encodeRtcWire('rtc-answer', sdp) }
export function decodeRtcPayload(raw: string): { kind: 'rtc-offer' | 'rtc-answer'; sdp: TightIceOffer } | null {
  const msg = decodeRtcWire(raw)
  if (!msg) return null
  return { kind: msg.t, sdp: msg.sdp }
}

export function webrtcAvailable(): boolean {
  return typeof RTCPeerConnection !== 'undefined'
}
