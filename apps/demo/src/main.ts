import './app.css'
import { initI18n, t, getLang, toggleLang } from './i18n'
import { el, clear, coarseWhen } from './ui/dom'
import { renderQr, keepAwake } from './ui/qr'
import { scanQr, cameraPlausible } from './ui/scanner'
import { loadState, saveState, resetAll, threadsInScope, upsertPeer, PERSONAS } from './state'
import type { DeviceState, Peer } from './state'
import { renderProfile } from './screens/profile'
import { renderInventory } from './screens/inventory'
import { detectAndParse } from './parse/index'
import { matchTemplate } from './match/lexical'
import { TEMPLATES, getTemplate } from './data/templates'
import { decide, interpret, settleAt, GATE_BUDGET_MS } from './gate'
import { derivePairKey, deriveEcdhPairKey, randomId } from './crypto'
import { encodeForQr, decodeFromQr } from './wire'
import type { Envelope } from './wire'
import { SEED_DIRECT_IOS } from './data/seed_direct'
import seedGroupRaw from './data/seed-wien-wohnen.txt?raw'
import type {
  ChatThread, QueryEnvelope, AnswerEnvelope, MatchResult, QueryTemplate, Identity,
  DecodedAnswer, LocalOutcome,
} from './types'
import { renderMessageList, renderComposer, renderSecurityInfo } from './screens/chat'
import type { ChatLogEntry } from './screens/chat'
import { wotMode, wotScenario } from './mode'
import { createRelayChannel } from './relay'
import type { RelayChannel, RelayStatus } from './relay'
import { ensureRelayIdentity } from './relay_identity'
import { ecdhSharedSecret } from './did'
import { storageIsEphemeral } from './db'
import { buildConnectAck, buildConnectLinkUrl, parseConnectLinkParams } from './connect_link'
import type { ConnectLinkParams } from './connect_link'
import { createWebrtcChannel, decodeRtcPayload, encodeAnswerPayload, encodeOfferPayload } from './webrtc'
import type { WebrtcChannel, WebrtcStatus } from './webrtc'
import { ACCOMMODATION_TEMPLATE, ACCOMMODATION_TEMPLATE_ID, accommodationPreviewDe, accommodationPreviewEn, matchAccommodation } from './match/accommodation'
import { SEED_GRAPH_NODES } from './data/geologengasse'
import type { GraphNode } from './data/geologengasse'

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

const root = document.getElementById('app') as HTMLElement
let state: DeviceState | null = null
let releaseWake: () => void = () => {}

type Screen = 'start' | 'home' | 'chats' | 'profile' | 'inventory' | 'connect' | 'ask' | 'answer' | 'link' | 'graph'
let screen: Screen = 'start'

// ---------------------------------------------------------------------------
// relay mode: session, status, and the in-flight query/answer this device is
// waiting on. All of this is inert (never touched) when wotMode() === 'qr',
// which is demo 1's exact, unchanged default -- see mode.ts.
// ---------------------------------------------------------------------------

let relayChannel: RelayChannel | null = null
let relayStatus: RelayStatus = 'connecting'
let relayStatusAt = 0
/** The badge currently on screen, if any -- see mountRelayStatusBadge(). Reset
 *  by shell() on every screen transition so a stale reference is never
 *  written into a detached DOM node. */
let relayStatusBadgeEl: HTMLElement | null = null
/** Set by handleIncomingEnvelope() when a QueryEnvelope arrives before the
 *  user has navigated to 'answer' themselves; screenAnswer() consumes it.
 *  Default scenario only -- see `pendingGeoQueries` below for demo 20. */
let pendingIncomingQuery: QueryEnvelope | null = null
/**
 * Demo 20 only. Several people can query Jakob independently, so a second
 * query arriving while he is still mid-consent-ceremony for a first one
 * must not silently clobber it (the default scenario's single
 * `pendingIncomingQuery` slot would do exactly that). Queued, FIFO;
 * screenAnswer() and the "next request" action after answering both drain
 * it one at a time.
 */
let pendingGeoQueries: QueryEnvelope[] = []
/** True from the moment a geo consent ceremony starts (runConsentCeremony)
 *  until its answer has actually been sent (emitAnswer's promise settles).
 *  See handleIncomingEnvelope's query branch for why this, not `screen`, is
 *  the correct "is a human decision pending right now" signal. */
let geoCeremonyBusy = false
/** The one query this device is currently waiting on an answer for, if any. */
let awaitingAnswer: { qid: string; resolve: (env: AnswerEnvelope) => void } | null = null

/**
 * The one-scan connect link (connect_link.ts): parsed once, at module load,
 * from whatever URL opened this page. `null` on every ordinary visit.
 * Consumed exactly once, by `completeConnectLinkIfPending()` -- see that
 * function for the phone's half of the ceremony this feature exists for.
 * `typeof location` guards this the same way relay.ts's own
 * `resolveRelayOrigin` does, for a non-jsdom test/Node context with no
 * global `location`.
 */
let pendingConnectLink: ConnectLinkParams | null =
  typeof location !== 'undefined' ? parseConnectLinkParams(location.search) : null

/**
 * Demo 20 only (`wotScenario() === 'geologengasse'`): every connect-ack that
 * has arrived over the relay but that Jakob has not yet tapped "Anfrage
 * bestätigen" for. `handleRawWire` pushes onto this list instead of
 * upserting a peer straight away -- see that function's scenario branch.
 *
 * Demo 20 is not a two-device demo: several people (the one excited relative,
 * then her friends) each open the same connect link and each send their own
 * request. Every request waits here, visibly, confirmed SEPARATELY -- one
 * "Anfrage bestätigen" tap per person, never a bulk accept. Keyed by `did`
 * (unique per requester's relay identity); a second ack from a did already
 * pending replaces that one entry rather than adding a duplicate card.
 */
let pendingAcceptRequests: { did: string; from: Identity }[] = []

// ---------------------------------------------------------------------------
// webrtc mode (demo 3) and ladder mode (demo 6): rung 2, a data channel with
// no server in the path. Inert (never created) when wotMode() is 'qr' or
// 'relay'. See webrtc.ts's module doc for what this rung does and does not
// protect, and webrtc_sdp.ts for why an SDP fits a QR at all.
// ---------------------------------------------------------------------------

let webrtcChannel: (WebrtcChannel & {
  createOffer: () => Promise<import('./webrtc_sdp').TightIceOffer>
  acceptAnswer: (a: import('./webrtc_sdp').TightIceOffer) => Promise<void>
  acceptOffer: (o: import('./webrtc_sdp').TightIceOffer) => Promise<import('./webrtc_sdp').TightIceOffer>
}) | null = null
let webrtcStatusBadgeEl: HTMLElement | null = null

/**
 * Set by demo 3's "über den Server versuchen" escape hatch (webrtc connect
 * failed or timed out) and by ladder mode's per-ask automatic fall-through.
 * Once true, ask/answer route over the relay for the rest of the session --
 * demo 3 never silently retries webrtc after a human has explicitly opted
 * out of the "no server" claim for this pairing.
 */
let useRelayFallback = false

/** Which rung actually carried the last ask/answer -- ladder mode's whole
 *  point is making this visible, not just true. */
type Rung = 'qr' | 'webrtc' | 'relay'
let lastRung: Rung | null = null

function webrtcStatusText(status: WebrtcStatus): string {
  switch (status) {
    case 'gathering-offer':
    case 'gathering-answer':
      return t('webrtcGathering')
    case 'awaiting-answer':
    case 'connecting':
      return t('webrtcConnecting')
    case 'open':
      return t('webrtcOpen')
    case 'failed':
      return t('webrtcFailedTitle')
    default:
      return t('noConnection')
  }
}

function mountWebrtcStatusBadge(): HTMLElement {
  const badge = el('p', { class: 'note' }, [webrtcChannel ? webrtcStatusText(webrtcChannel.status()) : t('noConnection')])
  webrtcStatusBadgeEl = badge
  return badge
}

function updateWebrtcStatusBadge(): void {
  if (webrtcStatusBadgeEl && webrtcChannel) webrtcStatusBadgeEl.textContent = webrtcStatusText(webrtcChannel.status())
}

function rungBadgeText(rung: Rung): string {
  if (rung === 'webrtc') return t('rungWebrtc')
  if (rung === 'relay') return useRelayFallback && webrtcChannel ? t('rungRelayAfterWebrtc') : t('rungRelay')
  return t('rungQr')
}

function relayStatusText(): string {
  const label =
    relayStatus === 'connected' ? t('relayConnected')
    : relayStatus === 'connecting' ? t('relayConnecting')
    : t('relayDisconnected')
  if (!relayStatusAt) return label
  const time = new Date(relayStatusAt).toLocaleTimeString(getLang() === 'de' ? 'de-AT' : 'en-GB')
  return `${label} (${t('relaySince')} ${time})`
}

/** Renders a live status line. Kept up to date by relayChannel's onStatus
 *  callback DIRECTLY MUTATING this element's textContent -- never by calling
 *  render() from a background event, which would tear down whatever the user
 *  is currently doing (a camera stream, a QR code holding a wake lock). */
function mountRelayStatusBadge(): HTMLElement {
  const badge = el('p', { class: 'note' }, [relayStatusText()])
  relayStatusBadgeEl = badge
  return badge
}

function updateRelayStatusBadge(): void {
  if (relayStatusBadgeEl) relayStatusBadgeEl.textContent = relayStatusText()
}

/**
 * (Re-)registers the drain sink. Must be called again whenever a pair key
 * can have changed -- a real connect ceremony overwrites nonceSelf/noncePeer
 * (or adds a new peer), and onEnvelope() only ever keeps one registration
 * (relay.ts), so a stale registration here means inbound wires silently
 * fail to decrypt and are never acked.
 *
 * Two shapes, picked by scenario:
 *
 *  - Every OTHER demo (default scenario): unchanged from before demo 20 --
 *    exactly one peer (`peers[0]`), one fixed key, registered once.
 *  - Demo 20 (`wotScenario() === 'geologengasse'`): Jakob's laptop can hold
 *    several peers at once (the excited relative, then her friends, each
 *    pairing separately -- see the coordinator's scope note this function
 *    exists to satisfy). relay.ts's `onEnvelope` now accepts a
 *    `PairKeyResolver` for exactly this: instead of one fixed key, a
 *    function that looks the right peer up by the wire's cleartext sender
 *    DID and derives THEIR pair key. It closes over `state` (not a copy of
 *    `state.peers`), so peers accepted after this registration are found
 *    too without needing to re-register -- `acceptPendingRequest()` still
 *    calls this again anyway, belt-and-suspenders, see its own doc comment.
 */
async function registerRelaySink(): Promise<void> {
  if (!relayChannel || !state) return
  if (wotScenario() === 'geologengasse') {
    const s = state
    relayChannel.onEnvelope(async (fromDid: string) => {
      const peer = s.peers.find((p) => p.did === fromDid)
      if (!peer) return null
      return pairKey(peer)
    }, handleIncomingEnvelope)
    return
  }
  const peer = state.peers[0]
  if (!peer) return
  const key = await pairKey(peer)
  relayChannel.onEnvelope(key, handleIncomingEnvelope)
}

/**
 * The conversation and the probe.
 *
 * Deliberately in memory only. This is a demo of a live link, not a messenger:
 * persisting it would mean deciding what happens to it on a device that blocks
 * storage (see db.ts), and none of that teaches anyone anything about whether
 * the connection works. Closing the tab ends the conversation, which is also
 * the honest thing to tell someone.
 */
const chatLog: ChatLogEntry[] = []
let unreadChat = 0
let pendingPing: { id: string; sentAt: number; resolve: (ms: number) => void } | null = null

/**
 * Send one envelope over whichever transport is currently up, without the
 * caller having to know which. Prefers the direct data channel when it is
 * open, because a message that never touches a server is the better
 * demonstration when both are available.
 *
 * Throws when nothing is connected, so a caller can say so rather than
 * silently dropping the message.
 */
/**
 * Send to ONE named peer, rather than to whoever happens to be `peers[0]`.
 *
 * Needed the moment several people are paired at once: accepting Kaja has to
 * tell Kaja, not whoever joined first. `sendOverActiveTransport` below stays
 * as the convenience wrapper for the single-peer demos.
 */
async function sendToPeer(peer: Peer, env: Envelope): Promise<void> {
  if (webrtcChannel && webrtcChannel.isOpen()) { webrtcChannel.send(env); return }
  if (!relayChannel || !peer.did) throw new Error(t('noConnection'))
  await relayChannel.send(peer.did, env, await pairKey(peer))
}

async function sendOverActiveTransport(env: Envelope): Promise<'webrtc' | 'relay'> {
  if (webrtcChannel && webrtcChannel.isOpen()) {
    webrtcChannel.send(env)
    return 'webrtc'
  }
  const s = state
  const peer = s?.peers[0]
  if (!relayChannel || !peer?.did) throw new Error(t('noConnection'))
  await relayChannel.send(peer.did, env, await pairKey(peer))
  return 'relay'
}

/** Dispatches a decrypted, validated inbound envelope. Registered as the
 *  inbound sink for BOTH relay.ts's `onEnvelope(key, cb)` (2-arg,
 *  `fromDid` unused here -- routing already narrowed to "the one paired
 *  peer", see below) and webrtc.ts's `onEnvelope(cb)` (1-arg) -- `_fromDid`
 *  is therefore optional, not just unused, so this one function satisfies
 *  both channel shapes. Never called at all when wotMode() === 'qr' (no
 *  channel is ever created there). */
function handleIncomingEnvelope(env: Envelope, _fromDid?: string): void {
  if (env.t === 'answer') {
    if (awaitingAnswer && env.qid === awaitingAnswer.qid) awaitingAnswer.resolve(env)
    return
  }
  if (env.t === 'query') {
    if (wotScenario() === 'geologengasse') {
      // Several peers can query Jakob independently -- queue rather than
      // clobber a ceremony already on screen. runConsentCeremony's own
      // `finish()` looks up the ANSWERING peer by `q.from.id`
      // (`s.peers.find(p => p.id === q.from.id)`), never `peers[0]`, so this
      // already routes the answer back to whoever actually asked.
      pendingGeoQueries.push(env)
      // `screen === 'answer'` is NOT a reliable "a ceremony is actively on
      // screen right now" signal on its own: runConsentCeremony() and
      // emitAnswer() draw the checking/consent/outcome beats with direct
      // shell() calls, never going through go(), so `screen` sits frozen at
      // 'answer' for the ENTIRE ceremony including its final "Antwort
      // gesendet" confirmation -- found by testing two guests asking close
      // together: the second query queued silently and stayed invisible
      // because this check saw 'answer' and did nothing. `geoCeremonyBusy`
      // is the real signal: true only while a consent decision is actually
      // pending a human tap. Idle elsewhere OR sitting on an already-
      // finished confirmation screen -> safe to (re)route here now.
      if (!geoCeremonyBusy) go('answer')
      return
    }
    // Default scenario: nothing here narrows this to the peer that is
    // actually paired -- these demos pair exactly one peer at a time
    // (state.ts's Peer[0] convention), so any arriving query is by
    // construction from that one peer.
    pendingIncomingQuery = env
    go('answer')
    return
  }
  if (env.t === 'chat') {
    chatLog.push({ kind: 'text', mine: false, text: env.text, at: Date.now() })
    // Only redraw if the person is looking at the conversation. Yanking them
    // out of a consent screen because a message arrived would be worse than
    // the message waiting.
    if (screen === 'link') render()
    else unreadChat += 1
    return
  }
  if (env.t === 'ping') {
    // Demo 20, guest side. This device sent a request and then had no way to
    // learn it had been confirmed, so it sat on "Anfrage gesendet" while it
    // was already connected. The first thing that arrives from a DID it knows
    // can only mean the other side accepted, so treat it as the signal and
    // land the person in the conversation with the name of who confirmed.
    const st = state
    if (wotScenario() === 'geologengasse' && st && st.me.id !== 'jakob' && screen !== 'link') {
      const from = st.peers.find((x) => x.did === _fromDid) ?? st.peers[0]
      justAccepted = from?.displayName ?? null
      go('link')
    }
    if (!env.back) {
      // Someone is testing the line. Answer immediately and say nothing about
      // it on screen: the test belongs to whoever pressed the button.
      void sendOverActiveTransport({ v: 1, t: 'ping', id: env.id, back: true })
    } else if (pendingPing && pendingPing.id === env.id) {
      pendingPing.resolve(Date.now() - pendingPing.sentAt)
    }
    return
  }
  // A ConnectEnvelope never travels over the relay in this app -- pairing is
  // QR-only (handover's Task 2/3 split) -- so this is unreachable in
  // practice; ignored rather than asserted, matching wire.ts's "never throw
  // on unexpected shape" posture.
}

/**
 * The relay channel's `onRawWire` sink (registered in bringUpRelayChannel):
 * fires for the CLEARTEXT `from`/`payload` of every drained wire, decrypted
 * or not -- see relay.ts's `onRawWire` doc comment for why. The only shape
 * this ever recognises is a `connect-ack` (connect_link.ts's module
 * header); every ordinary query/answer/chat/ping wire is AES-GCM ciphertext
 * base64url, which `decodeFromQr`'s `JSON.parse` fails on harmlessly, so
 * this is a silent no-op for all of them, exactly matching wire.ts's own
 * "never throw on unexpected shape" posture.
 *
 * This is the LAPTOP's half of the one-scan ceremony: the phone's
 * `completeConnectLinkIfPending()` sends this; receiving it here is what
 * lets the laptop finally learn who scanned its link and complete the
 * pairing on receipt, live, without a reload (screenConnect() re-renders
 * because `screen` never left `'connect'` while the link/QR was on
 * screen -- see showConnectLinkCode()).
 */
function handleRawWire(fromDid: string, payload: string): void {
  const env = decodeFromQr(payload)
  if (!env || env.t !== 'connect-ack') return
  // The outer wire's cleartext `from` (relay.ts's routing field) must match
  // what the envelope itself claims -- a mismatch is either a relay bug or
  // tampering, either way not something to trust silently.
  if (env.did !== fromDid) return
  const s = state
  if (!s) return
  if (wotScenario() === 'geologengasse') {
    // Demo 20: nobody joins Jakob's graph without an explicit tap on
    // "Anfrage bestätigen" -- see acceptPendingRequest() below. Several
    // people can have a request open at once; each one is confirmed
    // separately. A did already accepted (a resend of the same ack, e.g.
    // after a reload) never re-queues -- just make sure the multi-peer sink
    // still covers it.
    if (s.peers.some((p) => p.did === env.did)) {
      void registerRelaySink()
      return
    }
    const req = { did: env.did, from: env.from }
    const idx = pendingAcceptRequests.findIndex((r) => r.did === env.did)
    if (idx >= 0) pendingAcceptRequests[idx] = req
    else pendingAcceptRequests.push(req)
    if (screen === 'connect' || screen === 'home') render()
    return
  }
  upsertPeer(s, {
    id: env.from.id,
    displayName: env.from.displayName,
    // Unused placeholders: this peer's `pairing: 'ecdh'` means pairKey()
    // never reads these -- see state.ts's `Peer.pairing` doc comment. Filled
    // anyway because the Peer type still requires a value.
    nonceSelf: randomId(16),
    noncePeer: randomId(16),
    connectedAt: Date.now(),
    blocked: false,
    seeded: false,
    did: env.did,
    pairing: 'ecdh',
  })
  void saveState(s).then(() => registerRelaySink())
  if (screen === 'connect') render()
}

/**
 * Demo 20's accept gesture: the button labelled "Anfrage bestätigen" on ONE
 * person's pending-request card. Only after this runs does that requester
 * become one of `state.peers` (appended -- see state.ts's `upsertPeer`,
 * which pushes rather than replaces) AND does the graph screen show them as
 * a live, first-ring bubble -- see screenGraph()'s doc comment on why it
 * reads `state.peers` directly rather than a separate list.
 *
 * All three steps matter and must happen in this order: upsert the peer,
 * persist it, THEN re-register the relay sink. Skipping the third step is
 * the failure mode that looks like it worked -- the bubble appears, but the
 * multi-peer resolver (registerRelaySink()'s geologengasse branch) has
 * nothing telling it a new pair key now exists, so every query the newly
 * accepted person sends afterwards silently fails to decrypt and is never
 * acked. In practice `registerRelaySink()`'s resolver closes over `state`
 * itself and re-reads `state.peers` on every inbound wire, so a single
 * registration already covers peers accepted later too -- this call is
 * belt-and-suspenders, not load-bearing on every acceptance, but kept
 * explicit so that invariant is never assumed silently.
 */
async function acceptPendingRequest(did: string): Promise<void> {
  const s = state
  const idx = pendingAcceptRequests.findIndex((r) => r.did === did)
  if (!s || idx < 0) return
  const req = pendingAcceptRequests[idx]
  pendingAcceptRequests.splice(idx, 1)
  upsertPeer(s, {
    id: req.from.id,
    displayName: req.from.displayName,
    nonceSelf: randomId(16),
    noncePeer: randomId(16),
    connectedAt: Date.now(),
    blocked: false,
    seeded: false,
    did: req.did,
    pairing: 'ecdh',
  })
  await saveState(s)
  await registerRelaySink()

  // Tell the person they are in. Until this, the guest device had no signal at
  // all that the tap had happened, so it sat on a "request sent" screen
  // indefinitely while it was in fact already connected. Any envelope from a
  // DID the guest knows is proof of acceptance, so a probe is enough and no
  // new wire type is needed.
  const accepted = s.peers.find((x) => x.did === req.did)
  if (accepted) {
    try { await sendToPeer(accepted, { v: 1, t: 'ping', id: randomId(10), back: false }) }
    catch { /* the bubble and the peer are already real; a lost hello is not fatal */ }
  }
  justAccepted = req.from.displayName
  go('link')
}

/** Name of the person accepted a moment ago, so the chat screen can open with
 *  "Verbunden mit X" instead of silently appearing. Cleared once shown. */
let justAccepted: string | null = null

function declinePendingRequest(did: string): void {
  pendingAcceptRequests = pendingAcceptRequests.filter((r) => r.did !== did)
  render()
}

/**
 * The PHONE's half of the one-scan ceremony (connect_link.ts): if this page
 * was opened from a connect link, ensure this device's own relay identity
 * and relay channel exist, replace the seeded/previous peer with the real
 * one the link named, tell the laptop who we are (a `connect-ack`, sent
 * UNENCRYPTED via `sendRaw` -- see connect_link.ts's module header for why
 * that is safe here and nowhere else), and land on the connect screen so
 * this device ALSO shows "verbunden mit …" without a reload.
 *
 * A no-op with nothing pending, or outside relay mode -- the one-scan
 * ceremony is relay-only (the handover for this feature: "which demos get
 * this: demo 2 at minimum"). Called from boot() (a returning session that
 * happens to have been opened via a connect link -- unusual, but a device
 * already paired to someone else can still be re-pointed at a new peer) and
 * from seedPersona() (the ordinary first-visit case: a brand-new phone,
 * still on the persona picker, opened this exact link).
 */
async function completeConnectLinkIfPending(): Promise<void> {
  const params = pendingConnectLink
  if (!params || wotMode() !== 'relay' || !state) return
  pendingConnectLink = null
  // One-shot: a reload of this same tab must not re-send a stale ack, and
  // the peer's DID/id have no reason to sit in browser history once used.
  if (typeof history !== 'undefined') history.replaceState(null, '', location.pathname)

  const s = state
  const didIdentity = await ensureRelayIdentity(s)
  upsertPeer(s, {
    id: params.from.id,
    displayName: params.from.displayName,
    nonceSelf: randomId(16),
    noncePeer: randomId(16),
    connectedAt: Date.now(),
    blocked: false,
    seeded: false,
    did: params.did,
    pairing: 'ecdh',
  })
  await saveState(s)

  if (!relayChannel) await bringUpRelayChannel(s)
  await registerRelaySink()
  const ack = buildConnectAck(s.me, didIdentity)
  try {
    await relayChannel?.sendRaw(params.did, encodeForQr(ack))
  } catch {
    // The peer record above is already saved either way, so the laptop
    // learning about this pairing is only delayed, not lost -- a
    // reconnect's fresh registerRelaySink()/onRawWire registration (or the
    // laptop re-showing its link) can still complete it. Nothing to surface
    // here beyond what the connect screen's relay status badge already says.
  }
  go('connect')
}

/**
 * Opens this device's relay drain connection, once. A no-op in qr mode
 * (wotMode() !== 'relay') and a no-op if already initialised -- safe to call
 * from both boot() (a returning session) and seedPersona() (a fresh one).
 * Fire-and-forget on purpose: the caller does not await this, so the home
 * screen renders immediately and the connection catches up in the
 * background, its status reflected by the badge, never a blocking spinner.
 */
async function initRelaySession(): Promise<void> {
  // Ladder mode (demo 6) needs the relay live from the start -- it is rung
  // 3, the automatic fall-through, not something a human opts into. Webrtc
  // mode (demo 3) never calls this from boot/seedPersona; there the relay
  // is only ever brought up on demand, by ensureRelayFallback() below, once
  // a person has explicitly tapped "über den Server versuchen".
  if ((wotMode() !== 'relay' && wotMode() !== 'ladder') || !state || relayChannel) return
  await bringUpRelayChannel(state)
}

/** Shared by initRelaySession() (relay/ladder mode, automatic) and
 *  ensureRelayFallback() (webrtc mode, manual escape hatch). */
async function bringUpRelayChannel(s: DeviceState): Promise<void> {
  const identity = await ensureRelayIdentity(s)
  const channel = createRelayChannel()
  relayChannel = channel
  channel.onStatus((status, at) => {
    relayStatus = status
    relayStatusAt = at
    updateRelayStatusBadge()
  })
  // The one-scan connect-link ceremony's bootstrap sink (connect_link.ts) --
  // harmless to register unconditionally: it only ever recognises a
  // `connect-ack` payload, and every ordinary encrypted wire fails that
  // check silently (see handleRawWire's doc comment).
  channel.onRawWire(handleRawWire)
  await registerRelaySink()
  try {
    await channel.connect(identity)
  } catch {
    // The status badge already reflects this ('disconnected'); relay.ts's
    // channel keeps retrying with backoff in the background regardless, and
    // onStatus will report 'connected' the moment a later attempt succeeds.
  }
}

/**
 * Demo 3's manual escape hatch: brings up the exact same relay channel
 * relay/ladder mode use, on demand, the first time a person taps "über den
 * Server versuchen" after a webrtc connect failure or timeout. Idempotent --
 * a second tap (e.g. after backing out and returning) does not open a
 * second channel.
 */
async function ensureRelayFallback(): Promise<void> {
  useRelayFallback = true
  if (relayChannel || !state) return
  await bringUpRelayChannel(state)
}

/**
 * Races a relay send against an inbound answer for `qid` and a timeout.
 * `cancel()` tears down the wait without resolving -- used when the user
 * backs out or switches to the QR fallback, so a late answer does not fire
 * into a screen that has moved on.
 */
const RELAY_ANSWER_TIMEOUT_MS = 20_000

/** How long to wait for an answer over an already-open webrtc data channel
 *  before treating it as failed. Shorter than the relay's timeout: there is
 *  no network hop or server queue to account for, only the other device's
 *  own machine-time-equalisation budget (gate.ts's GATE_BUDGET_MS, 900ms)
 *  plus however long a person takes to look at the consent prompt and tap
 *  yes/no -- 20s stays generous for that human factor while still failing
 *  fast enough that the ladder's automatic fall-through (or demo 3's manual
 *  escape hatch) is not itself a bad experience. */
const WEBRTC_ANSWER_TIMEOUT_MS = 20_000

function waitForAnswer(qid: string, timeoutMs: number): { promise: Promise<AnswerEnvelope | null>; cancel: () => void } {
  let done = false
  let resolveFn: (env: AnswerEnvelope | null) => void = () => {}
  const promise = new Promise<AnswerEnvelope | null>((resolve) => { resolveFn = resolve })
  const timer = setTimeout(() => {
    if (done) return
    done = true
    if (awaitingAnswer?.qid === qid) awaitingAnswer = null
    resolveFn(null)
  }, timeoutMs)
  awaitingAnswer = {
    qid,
    resolve: (env) => {
      if (done) return
      done = true
      clearTimeout(timer)
      awaitingAnswer = null
      resolveFn(env)
    },
  }
  const cancel = (): void => {
    if (done) return
    done = true
    clearTimeout(timer)
    if (awaitingAnswer?.qid === qid) awaitingAnswer = null
    resolveFn(null)
  }
  return { promise, cancel }
}

function shell(title: string, body: HTMLElement, opts: { back?: () => void } = {}): void {
  releaseWake()
  releaseWake = () => {}
  relayStatusBadgeEl = null
  webrtcStatusBadgeEl = null
  clear(root)
  const lang = getLang()
  const bar = el('div', { class: 'topbar' }, [
    opts.back
      ? el('button', { class: 'langtoggle', onclick: opts.back, 'aria-label': t('back') }, ['←'])
      : null,
    el('div', { class: 'who' }, [
      title,
      state ? el('small', {}, [state.me.displayName + ' · ' + t('appName')]) : null,
    ]),
    el('button', {
      class: 'langtoggle',
      onclick: () => { toggleLang(); render() },
      'aria-label': 'Sprache wechseln / switch language',
    }, [
      lang === 'de' ? el('b', {}, ['DE']) : document.createTextNode('DE'),
      document.createTextNode(' / '),
      lang === 'en' ? el('b', {}, ['EN']) : document.createTextNode('EN'),
    ]),
  ])
  const nb = netBubble()
  root.append(bar, el('main', {}, [body]))
  if (nb) root.append(nb)
}


/**
 * The little corner marker showing the web growing.
 *
 * Deliberately a small thing at the edge, not a banner across the top: the
 * owner asked for something "not on top of everything, but a bubble on the
 * side". It pulses when the count goes up, which is the only moment it has
 * anything to say, and a tap opens the full graph. Demo 20 only, since it is
 * the only scenario where the number can be more than one.
 */
let lastPeerCount = 0
function netBubble(): HTMLElement | null {
  if (wotScenario() !== 'geologengasse' || !state) return null
  const n = state.peers.length
  if (n === 0) return null
  const grew = n > lastPeerCount
  lastPeerCount = n
  const bubble = el('button', {
    // The chat screen now pins a composer to the bottom (chat-signal
    // handover, item 4) -- lift the bubble clear of it there, same fixed
    // corner everywhere else.
    class: 'netbubble' + (grew ? ' grew' : '') + (screen === 'link' ? ' above-composer' : ''),
    onclick: () => go('graph'),
    'aria-label': t('netGrew'),
  }, [
    el('b', {}, [String(n)]),
    el('small', {}, [n === 1 ? t('netGrew') : t('netPeople')]),
  ])
  return bubble
}

function go(s: Screen): void { screen = s; render() }

function render(): void {
  if (!state) return void screenStart()
  switch (screen) {
    case 'chats':     return screenChats()
    case 'profile':   return screenProfile()
    case 'inventory': return screenInventory()
    case 'connect': return screenConnect()
    case 'ask':     return screenAsk()
    case 'answer':  return screenAnswer()
    case 'link':    return screenLink()
    case 'graph':   return screenGraph()
    default:        return screenHome()
  }
}

// ---------------------------------------------------------------------------
// start: pick a persona, seed the device
// ---------------------------------------------------------------------------

/**
 * Demo 20's start screen: no persona picker, ever.
 *
 * By construction this only ever renders on an INVITED device (a phone that
 * opened the connect link) -- boot() auto-seeds Jakob's own laptop straight
 * to `home` the moment it sees geologengasse scenario + no pending link +
 * no existing state, so the laptop never shows a start screen at all. See
 * boot()'s doc comment.
 *
 * "The invited device asks for a NAME, free text, and uses it as their
 * identity" (handover). Reuses `completeConnectLinkIfPending()` completely
 * unmodified for the actual pairing -- this only decides WHAT identity gets
 * created before that runs.
 */
function screenGeoNameEntry(): void {
  const invitedBy = pendingConnectLink?.from.displayName ?? ''
  const nameInput = el('input', {
    type: 'text',
    class: 'field',
    placeholder: t('geoNamePh'),
    autofocus: true,
    style: 'width:100%;border-radius:14px;border:1px solid var(--line);background:var(--bg-raised);color:var(--ink);padding:12px;font:inherit;margin-bottom:14px',
  }) as HTMLInputElement
  const placeInput = el('input', {
    type: 'text',
    class: 'field',
    placeholder: t('geoPlacePh'),
    style: 'width:100%;border-radius:14px;border:1px solid var(--line);background:var(--bg-raised);color:var(--ink);padding:12px;font:inherit;margin-bottom:14px',
  }) as HTMLInputElement
  const submit = (): void => { void seedGeoGuest(nameInput.value, placeInput.value) }
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
  placeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
  const body = el('div', {}, [
    el('h1', {}, [t('geoNameTitle')]),
    el('div', { class: 'card' }, [
      el('h3', {}, [t('invitedBy') + ' ' + invitedBy]),
      el('p', {}, [t('geoInvitedNote')]),
    ]),
    nameInput,
    placeInput,
    el('p', { class: 'note' }, [t('geoNameOptional')]),
    el('button', { class: 'btn primary', onclick: submit }, [t('geoNameSend')]),
  ])
  clear(root)
  root.append(
    el('div', { class: 'topbar' }, [
      el('div', { class: 'who' }, [t('appName')]),
      el('button', { class: 'langtoggle', onclick: () => { toggleLang(); render() } }, [
        getLang() === 'de' ? el('b', {}, ['DE']) : document.createTextNode('DE'),
        document.createTextNode(' / '),
        getLang() === 'en' ? el('b', {}, ['EN']) : document.createTextNode('EN'),
      ]),
    ]),
    el('main', {}, [body]),
  )
}

function screenStart(): void {
  if (wotScenario() === 'geologengasse') { screenGeoNameEntry(); return }
  const lang = getLang()
  // A device that arrived by connect link lands HERE first, not on a
  // connection. Without this line it reads as a plain start screen and the
  // person has no idea a pairing is waiting on the other side of the choice.
  const invitedBy = pendingConnectLink?.from.displayName
  const body = el('div', {}, [
    el('h1', {}, [t('whoAreYou')]),
    invitedBy
      ? el('div', { class: 'card' }, [
          el('h3', {}, [t('invitedBy') + ' ' + invitedBy]),
          el('p', {}, [t('invitedByNote')]),
        ])
      : null,
    el('p', { class: 'lead' }, [t('pickPersona')]),
    ...PERSONAS.map((p) =>
      el('div', { class: 'card' }, [
        el('h3', {}, [p.displayName]),
        el('p', {}, [p.blurb[lang]]),
        el('button', {
          class: 'btn primary',
          onclick: () => void seedPersona(p.id, p.displayName, p.role),
        }, [t('continueAs') + ' ' + p.displayName]),
      ]),
    ),
  ])
  clear(root)
  root.append(
    el('div', { class: 'topbar' }, [
      el('div', { class: 'who' }, [t('appName')]),
      el('button', { class: 'langtoggle', onclick: () => { toggleLang(); render() } }, [
        getLang() === 'de' ? el('b', {}, ['DE']) : document.createTextNode('DE'),
        document.createTextNode(' / '),
        getLang() === 'en' ? el('b', {}, ['EN']) : document.createTextNode('EN'),
      ]),
    ]),
    el('main', {}, [body]),
  )
}

async function seedPersona(id: string, displayName: string, role: 'holder' | 'seeker'): Promise<void> {
  const persona = PERSONAS.find((p) => p.id === id)
  const threads: ChatThread[] = []
  if (role === 'holder') {
    // The holder carries the neighbourhood group, and one direct chat that is
    // excluded by default so the opt-out is visible rather than asserted.
    const group = detectAndParse('Otta Graetzl & Alltag.txt', seedGroupRaw)
    group.title = 'Otta Grätzl & Alltag'
    group.included = true
    threads.push(group)
    const direct = detectAndParse('Klaus.txt', SEED_DIRECT_IOS)
    direct.title = 'Klaus'
    direct.included = false
    threads.push(direct)
  }
  // The connection is PRE-SEEDED on purpose.
  //
  // The QR ceremony is worth showing, but it is theatre: the query is the
  // product. If a camera misbehaves in the room, the demo must still reach the
  // part that matters. Both devices seed the same fixed nonce pair, so both
  // derive the same key with or without the ceremony, and re-running the
  // ceremony for real simply overwrites these with fresh nonces.
  //
  // `seeded: true` is what keeps this convenience from becoming a lie. Every
  // screen that mentions the pairing reads this flag and says "vorgekoppelt
  // für diese Demo" instead of "verbunden mit". An app whose whole pitch is
  // that you can trust what it tells you cannot open by telling you something
  // that is not so.
  const other = PERSONAS.find((p) => p.id !== id)
  const peers = other
    ? [{
        id: other.id,
        displayName: other.displayName,
        nonceSelf: DEMO_NONCE[id] ?? randomId(16),
        noncePeer: DEMO_NONCE[other.id] ?? randomId(16),
        connectedAt: Date.now(),
        blocked: false,
        seeded: true,
      }]
    : []
  // Deep-copy the persona's seed profile/inventory rather than referencing
  // PERSONAS directly: PERSONAS is a module-level constant, shared across
  // every seedPersona() call (including a demo reset), and inventory rows
  // get their own id/createdAt fresh each time rather than reusing the
  // template's.
  const profile = persona ? { ...persona.profile, languages: [...persona.profile.languages] } : { displayName, bio: '', neighbourhood: '', languages: [] }
  const inventory = (persona?.inventorySeed ?? []).map((seed) => ({
    ...seed,
    id: randomId(8),
    createdAt: new Date().toISOString(),
  }))
  state = { me: { id, displayName }, threads, peers, profile, inventory }
  await saveState(state)
  // The ordinary first-visit case for the one-scan connect-link ceremony
  // (connect_link.ts): a brand-new phone was still on the persona picker
  // when it opened the link (no state existed yet for boot() to find it),
  // so this is the first point a persona -- and therefore a relay identity
  // and a peer list -- exists to attach the pairing to. Completing it here
  // instead of after `go('home')` avoids a home-screen flash before jumping
  // straight to 'connect'.
  if (pendingConnectLink) {
    await completeConnectLinkIfPending()
  } else {
    void initRelaySession()
    go('home')
  }
}

/** Fixed demo nonces so both devices start out already paired. See seedPersona. */
const DEMO_NONCE: Record<string, string> = {
  marlene0: 'demo-nonce-marlene-2026',
  nora0000: 'demo-nonce-nora-2026',
}

// ---------------------------------------------------------------------------
// demo 20: Jakob's own device, and an invited guest's device. Two separate
// seed functions instead of PERSONAS -- see PERSONAS' own doc comment ("the
// two demo personas") for why that list is deliberately not reused here:
// this scenario is the owner's real flat, not a fictional persona, and the
// invited side's identity is typed in by a real person, not picked from a
// list.
// ---------------------------------------------------------------------------

/**
 * Jakob's own laptop. No pre-seeded peer -- unlike seedPersona()'s two
 * personas, which pair with each other before any ceremony runs, Jakob
 * starts with `peers: []`. Every peer he ever has came from a real connect
 * link and a real tap on "Anfrage bestätigen" (acceptPendingRequest()) --
 * there is no fictional counterpart to fake a pairing with. Called from
 * boot() the moment a fresh visit has geologengasse scenario, no state yet,
 * and no pending connect link -- i.e. this IS the laptop opening the demo
 * for the first time, not a phone that just scanned a link (that case is
 * seedGeoGuest() below).
 */
async function seedJakob(): Promise<void> {
  state = {
    me: { id: 'jakob', displayName: 'Jakob' },
    threads: [],
    peers: [],
    profile: { displayName: 'Jakob', bio: '', neighbourhood: 'Wien', languages: ['Deutsch'] },
    inventory: [],
  }
  await saveState(state)
  void initRelaySession()
}

/**
 * An invited phone, after it types in a free-text name (screenGeoNameEntry
 * above) and taps "Anfrage senden". Also starts with `peers: []` --
 * `completeConnectLinkIfPending()` (unmodified, reused exactly) adds Jakob
 * as this device's own peer once the connect-ack is sent, which is a
 * separate step from Jakob accepting THIS device on his side (see
 * acceptPendingRequest()'s doc comment on why that asymmetry is correct:
 * the guest already knows who they are requesting to connect to; Jakob is
 * the one who has to decide whether to let them in).
 */
/**
 * What to call a connection nobody named.
 *
 * The name is optional on purpose: someone scanning a stranger's code at an
 * event may not want to type a name, and forcing one is both a friction and a
 * small coercion. So an unnamed connection is labelled by WHEN it was made,
 * and by WHERE only if the person typed a place themselves.
 *
 * No geolocation. Turning coordinates into a place name means asking a third
 * party where this person is, which is precisely the thing this app tells
 * people it does not do. A free-text "beim Konzert" is more useful anyway,
 * and it stays on the device.
 */
function unnamedConnectionLabel(place: string): string {
  const when = new Date().toLocaleString(getLang() === 'de' ? 'de-AT' : 'en-GB',
    { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
  return place ? `${t('geoMetAt')} ${place}, ${when}` : `${t('geoMetOn')} ${when}`
}

async function seedGeoGuest(rawName: string, rawPlace = ''): Promise<void> {
  const place = rawPlace.trim().slice(0, 40)
  const displayName = rawName.trim().slice(0, 60) || unnamedConnectionLabel(place)
  state = {
    me: { id: randomId(8), displayName },
    threads: [],
    peers: [],
    profile: { displayName, bio: '', neighbourhood: '', languages: [] },
    inventory: [],
  }
  await saveState(state)
  if (pendingConnectLink) {
    await completeConnectLinkIfPending()
  } else {
    // Should not happen -- screenGeoNameEntry only renders when a connect
    // link is pending -- but a demo must never hang on an impossible state.
    void initRelaySession()
    go('home')
  }
}

// ---------------------------------------------------------------------------
// home
// ---------------------------------------------------------------------------

/**
 * The one sentence every screen uses to describe the pairing.
 *
 * Three states, three different sentences, and they must not blur into each
 * other: no peer at all, a seeded peer (the demo put it there), and a peer two
 * people actually created by holding phones up to each other. Centralised so a
 * new screen cannot accidentally reintroduce the claim we just removed.
 */
function peerStatusLine(peer: Peer | undefined): string {
  if (!peer) return t('noConnection')
  if (peer.seeded) return t('seededWith') + ' ' + peer.displayName
  return t('connectedWith') + ' ' + peer.displayName
}

/**
 * One pending request card: name, and its own separate "Anfrage
 * bestätigen"/"Ablehnen" pair. Rendered once per entry in
 * `pendingAcceptRequests` -- several people can be waiting at once (the one
 * excited relative, then her friends), and each is confirmed on its own,
 * never in bulk.
 */
function pendingRequestCard(req: { did: string; from: Identity }): HTMLElement {
  return el('div', { class: 'card' }, [
    el('h3', {}, [t('geoPendingTitle')]),
    el('p', {}, [
      el('b', {}, [req.from.displayName]),
      document.createTextNode(' ' + t('geoPendingBody')),
    ]),
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn', onclick: () => declinePendingRequest(req.did) }, [t('geoDeclineBtn')]),
      el('button', { class: 'btn primary', onclick: () => void acceptPendingRequest(req.did) }, [t('geoAcceptBtn')]),
    ]),
  ])
}

function screenHome(): void {
  const s = state as DeviceState
  const peer = s.peers[0]
  const geo = wotScenario() === 'geologengasse'
  const body = el('div', {}, [
    el('h1', {}, [t('appName')]),
    ...(geo ? pendingAcceptRequests.map(pendingRequestCard) : []),
    geo
      ? el('div', { class: 'card' }, [
          el('h3', {}, [t('geoGraphNav')]),
          el('p', {}, [
            s.peers.length
              ? `${s.peers.length} ${s.peers.length === 1 ? t('geoNetworkCountOne') : t('geoNetworkCount')}`
              : t('noConnection'),
          ]),
          el('div', { class: 'btnrow' }, [
            el('button', { class: 'btn', onclick: () => go('connect') }, [t('navConnect')]),
            el('button', { class: 'btn primary', onclick: () => go('graph') }, [t('geoGraphNav')]),
          ]),
        ])
      : el('div', { class: 'card' }, [
          el('h3', {}, [t('navConnect')]),
          el('p', {}, [peerStatusLine(peer)]),
          peer?.seeded ? el('p', { class: 'seeded' }, [t('seededNote')]) : null,
          el('button', { class: 'btn', onclick: () => go('connect') }, [t('navConnect')]),
        ]),
    el('button', { class: 'btn primary', onclick: () => go('ask') }, [t('navAsk')]),
    el('button', { class: 'btn', onclick: () => go('answer') }, [t('navAnswer')]),
    // Only in the modes that actually hold a connection. In qr mode there is
    // nothing to test and nothing to type into.
    // Straight into the conversation. The fastest way to believe a connection
    // is real is to type a word on one device and see it on the other, so this
    // is one tap from the first screen, not buried.
    wotMode() !== 'qr' && peer
      ? el('button', { class: 'btn primary', onclick: () => go('link') }, [
          t('navChatNow') + (unreadChat ? ` (${unreadChat})` : ''),
        ])
      : null,
    el('button', { class: 'btn quiet', onclick: () => go('chats') }, [
      t('navChats') + ' (' + s.threads.length + ')',
    ]),
    el('button', { class: 'btn quiet', onclick: () => go('inventory') }, [
      t('navInventory') + ' (' + s.inventory.length + ')',
    ]),
    el('button', { class: 'btn quiet', onclick: () => go('profile') }, [t('navProfile')]),
    el('div', { class: 'note' }, [
      el('button', {
        class: 'btn danger',
        onclick: () => { if (confirm(t('resetConfirm'))) void resetAll().then(() => location.reload()) },
      }, [t('reset')]),
    ]),
  ])
  shell(t('appName'), body)
}

// ---------------------------------------------------------------------------
// chats: the 1-on-1 opt-out lives here
// ---------------------------------------------------------------------------

function threadRow(th: ChatThread): HTMLElement {
  const s = state as DeviceState
  const box = el('input', { type: 'checkbox', ...(th.included ? { checked: true } : {}) }) as HTMLInputElement
  const stateLabel = el('small', { class: 'state', style: 'margin-left:10px' }, [
    th.included ? t('included') : t('excluded'),
  ])
  box.addEventListener('change', () => {
    th.included = box.checked
    void saveState(s)
    stateLabel.textContent = th.included ? t('included') : t('excluded')
  })
  const humans = th.messages.filter((m) => !m.system).length
  const row = el('div', { class: 'thread' }, [
    el('div', { class: 'meta' }, [
      el('b', {}, [th.title]),
      el('small', {}, [
        humans + ' ' + t('msgCount') + ' · ' + th.participants.length + ' ' + t('people'),
      ]),
      el('div', {}, [
        el('span', { class: 'kind' }, [th.kind === 'group' ? t('kindGroup') : t('kindDirect')]),
        stateLabel,
      ]),
    ]),
    el('label', { class: 'sw' }, [box, el('span', {})]),
  ])
  return row
}

function screenChats(): void {
  const s = state as DeviceState
  const groups = s.threads.filter((x) => x.kind === 'group')
  const directs = s.threads.filter((x) => x.kind === 'direct')

  const fileInput = el('input', {
    type: 'file',
    accept: '.txt,.json,.zip,text/plain,application/json',
    style: 'display:none',
  }) as HTMLInputElement
  fileInput.addEventListener('change', () => { void onImport(fileInput) })

  const body = el('div', {}, [
    el('h1', {}, [t('chatsTitle')]),
    el('p', { class: 'lead' }, [t('chatsLead')]),
    el('h2', {}, [t('groupChats')]),
    ...groups.map(threadRow),
    el('h2', {}, [t('directChats')]),
    el('p', {}, [t('directOff')]),
    ...(directs.length ? directs.map(threadRow) : [el('p', {}, [t('noDirect')])]),
    el('h2', {}, [t('importChat')]),
    el('p', {}, [t('importHow')]),
    fileInput,
    el('button', { class: 'btn', onclick: () => fileInput.click() }, [t('importChat')]),
  ])
  shell(t('navChats'), body, { back: () => go('home') })
}

async function onImport(input: HTMLInputElement): Promise<void> {
  const f = input.files?.[0]
  if (!f) return
  const s = state as DeviceState
  try {
    const raw = await f.text()
    const th = detectAndParse(f.name, raw)
    if (!th.messages.length) throw new Error('no messages')
    th.title = f.name.replace(/\.[^.]+$/, '').replace(/^WhatsApp Chat (mit|with) /i, '')
    s.threads.push(th)
    await saveState(s)
  } catch {
    alert(t('importFailed'))
  }
  input.value = ''
  render()
}

// ---------------------------------------------------------------------------
// profile and inventory: thin wrappers, real content lives in src/screens/
// ---------------------------------------------------------------------------

function screenProfile(): void {
  const s = state as DeviceState
  const body = renderProfile(
    s,
    () => void saveState(s),
    () => { void saveState(s); render() /* topbar name may have changed */ },
  )
  shell(t('navProfile'), body, { back: () => go('home') })
}

function screenInventory(): void {
  const s = state as DeviceState
  const body = renderInventory(s, () => void saveState(s), () => go('inventory'))
  shell(t('navInventory'), body, { back: () => go('home') })
}

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

function screenConnect(): void {
  const s = state as DeviceState
  const peer = s.peers[0]
  const relay = wotMode() === 'relay'
  const webrtc = wotMode() === 'webrtc' || wotMode() === 'ladder'
  const geo = wotScenario() === 'geologengasse'
  const isJakob = geo && s.me.id === 'jakob'
  const body = el('div', {}, [
    el('h1', {}, [t('connectTitle')]),
    el('p', { class: 'lead' }, [t('connectLead')]),
    relay ? el('p', { class: 'note' }, [t('relayExplain')]) : null,
    relay ? el('div', { class: 'card' }, [mountRelayStatusBadge()]) : null,
    wotMode() === 'ladder' ? el('p', { class: 'note' }, [t('ladderExplain')]) : null,
    // Demo 20, Jakob's side: every pending request, each confirmed
    // separately -- see pendingRequestCard()'s doc comment.
    ...(isJakob ? pendingAcceptRequests.map(pendingRequestCard) : []),
    // Demo 20, several peers at once (isJakob): a plain list, not the
    // single-peer card below. Every other case (every other demo, and a
    // demo-20 GUEST device, which only ever has Jakob as its one peer)
    // keeps the original single-peer card unchanged.
    isJakob
      ? el('div', { class: 'card' }, [
          el('h3', {}, [t('geoGraphNav')]),
          s.peers.length
            ? el('ul', {}, s.peers.map((p) => el('li', {}, [p.displayName])))
            : el('p', {}, [t('noConnection')]),
        ])
      : peer ? el('div', { class: 'card' }, [
          el('h3', {}, [peerStatusLine(peer)]),
          peer.seeded
            ? el('p', { class: 'seeded' }, [t('seededNote')])
            : el('p', {}, [new Date(peer.connectedAt).toLocaleString(getLang() === 'de' ? 'de-AT' : 'en-GB')]),
          // Demo 20, guest side: there is no signal telling this device
          // whether Jakob has tapped "Anfrage bestätigen" yet -- say that
          // honestly rather than implying a live connection already exists.
          geo ? el('p', { class: 'note' }, [t('geoRequestSentTitle') + ': ' + t('geoRequestSentBody')]) : null,
        ]) : null,
    // The one-scan connect link (connect_link.ts): relay mode only, and the
    // PRIMARY affordance there -- it is the whole reason this feature exists
    // (a phone whose camera can only open a link, GrapheneOS, cannot use the
    // JSON codes below at all). The two-scan codes stay available underneath
    // for every other mode and as a fallback.
    relay ? el('button', { class: 'btn primary', onclick: () => void showConnectLinkCode() }, [t('showConnectLink')]) : null,
    relay ? el('p', { class: 'note' }, [t('connectLinkExplain')]) : null,
    // The honest chaining limit (docs/query-traversal.md): whoever joins
    // through this same link can query the device that showed it to them,
    // never anyone further up the chain. Shown wherever the link itself is
    // shown, not buried in a separate screen nobody visits.
    geo && relay ? el('p', { class: 'note' }, [t('geoChainHonesty')]) : null,
    // The two ceremonies are different things and used to sit as adjacent
    // buttons, which cost a real session: the owner pressed "Meinen Code
    // zeigen" expecting the direct connection, got the relay pairing, and
    // reported "I didn't see any device to connect with". They are now in
    // separate labelled cards, and the direct one spells out its three steps,
    // because there is no device discovery here by design and nobody can be
    // expected to infer that from a button.
    el('div', { class: 'card' }, [
      el('h3', {}, [t('connectPairTitle')]),
      el('p', { class: 'note' }, [t('connectPairExplain')]),
      el('button', { class: relay ? 'btn' : 'btn primary', onclick: () => void showMyConnectCode() }, [t('showMyCode')]),
      el('button', { class: 'btn', onclick: () => void scanConnectCode() }, [t('scanTheirCode')]),
    ]),
    wotMode() !== 'qr' && peer
      ? el('button', { class: 'btn primary', onclick: () => go('link') }, [t('navChatNow')])
      : null,
    webrtc && peer ? el('div', { class: 'card' }, [
      el('h3', {}, [t('webrtcCardTitle')]),
      el('p', { class: 'note' }, [t('webrtcExplain')]),
      el('p', { class: 'note' }, [t('webrtcSteps')]),
      mountWebrtcStatusBadge(),
      el('button', { class: 'btn primary', onclick: () => void startWebrtcOffer() }, [t('webrtcOfferBtn')]),
      el('button', { class: 'btn', onclick: () => void startWebrtcAccept() }, [t('webrtcAcceptBtn')]),
    ]) : null,
  ])
  shell(t('navConnect'), body, { back: () => go('home') })
}

function myNonce(): string {
  const s = state as DeviceState
  const existing = s.peers[0]?.nonceSelf
  return existing ?? randomId(16)
}

/**
 * True for any build that might ever route an ask/answer over the relay --
 * either as its primary transport (relay mode, demo 2) or as a fallback a
 * human or the ladder can reach for (webrtc mode's "über den Server
 * versuchen", ladder mode's automatic rung 3). Webrtc mode's own claim is
 * "no server in the path" for the connection itself, but that fallback only
 * works at all if both sides already know each other's did:peer:2 -- which
 * has to travel on the ONE ceremony that happens before anything else can
 * fail, the connect QR. Minting the identity is a local, offline operation
 * (did:peer:2 is self-certifying, see did.ts); nothing here contacts a
 * server, on any mode.
 */
function needsRelayIdentity(): boolean {
  const m = wotMode()
  return m === 'relay' || m === 'webrtc' || m === 'ladder'
}

async function showMyConnectCode(): Promise<void> {
  const s = state as DeviceState
  const nonce = myNonce()
  // OPTIONAL (wire.ts's ConnectEnvelope.did doc comment): carries this
  // device's did:peer:2 so the other side can address it over the relay --
  // as demo 2's primary transport, or as demo 3/6's fallback. Absent
  // entirely in a qr-mode build -- the object literal below has no `did`
  // key at all in that case, so encodeForQr() produces byte-identical
  // output to demo 1's.
  const did = needsRelayIdentity() ? (await ensureRelayIdentity(s)).did : undefined
  const payload = encodeForQr({ v: 1, t: 'connect', from: s.me, nonce, ...(did ? { did } : {}) })
  // Showing a code proves nothing on its own: something still has to come
  // back. Reported from the room as "we have essentially only proven a QR code
  // scanning". So the showing device carries the other half of the ceremony on
  // the same screen -- one tap to the scan view, which has both a camera and a
  // paste box -- instead of leaving the person on a dead end with a picture.
  await showCodeScreen(t('showMyCode'), payload, t('connectLead'), () => go('connect'), {
    label: t('scanTheirCode'),
    action: () => void scanConnectCode(),
  }, t('showMyCodeFootnote'))
  // Remember our own nonce so a later scan can complete the pair.
  const p = s.peers[0]
  if (p) { p.nonceSelf = nonce; await saveState(s) }
  else { pendingSelfNonce = nonce }
}

/**
 * The laptop's half of the one-scan connect-link ceremony (connect_link.ts):
 * shows a QR encoding a URL (not JSON, unlike `showMyConnectCode` above) so
 * a phone's native camera app -- the ONLY option on GrapheneOS, this
 * feature's whole reason for existing -- can open it directly. Reuses
 * `showCodeScreen` exactly as `showMyConnectCode` does, since it already
 * renders whatever payload string it is given as a QR plus a copy button;
 * the only difference is what that payload IS.
 *
 * Deliberately does NOT call `go()` -- `screen` stays `'connect'` the whole
 * time this is on screen, matching `showMyConnectCode`'s own convention.
 * That is what makes the live update work with no extra plumbing:
 * `handleRawWire`'s `if (screen === 'connect') render()`, once the phone's
 * `connect-ack` arrives, redraws `screenConnect()` in place -- which now
 * shows "Verbunden mit …" (`peerStatusLine`, state.ts) instead of the QR --
 * satisfying the handover's explicit complaint about screens that change
 * nothing after a successful action.
 */
async function showConnectLinkCode(): Promise<void> {
  const s = state as DeviceState
  const identity = await ensureRelayIdentity(s)
  // Deliberately origin + directory path, not a bare `location.origin` --
  // mirrors `apps/mobile-ui/src/screens/meet.js`'s `appBaseUrl` exactly (see
  // that file's comment): this app may be served under a path prefix
  // (`WOT_BASE`, mode.ts), and a bare origin would silently land the phone
  // back at the domain root instead of this build.
  const origin = window.location.origin + window.location.pathname.replace(/[^/]*$/, '')
  const url = buildConnectLinkUrl(origin, identity.did, s.me)
  const footnote = t('connectLinkHonesty')
    + (storageIsEphemeral() ? ' ' + t('connectLinkEphemeralNote') : '')
    // The chaining limit, right on the screen someone hands to a third
    // person: whoever pairs through THIS link can query THIS device, never
    // any further up the chain -- docs/query-traversal.md, and the
    // handover's own "getting this wrong would be the worst possible
    // failure in front of this audience".
    + (wotScenario() === 'geologengasse' ? ' ' + t('geoChainHonesty') : '')
  await showCodeScreen(t('showConnectLink'), url, t('connectLinkHint'), () => go('connect'), undefined, footnote)
}

let pendingSelfNonce: string | null = null

async function scanConnectCode(): Promise<void> {
  await scanScreen(t('scanTheirCode'), async (text) => {
    const env = decodeFromQr(text)
    if (!env) return { ok: false, msg: t('badCode') }
    if (env.t !== 'connect') return { ok: false, msg: t('wrongCode') }
    const s = state as DeviceState
    const self = pendingSelfNonce ?? s.peers[0]?.nonceSelf ?? randomId(16)
    pendingSelfNonce = self
    // A completed ceremony is the ONLY thing that clears `seeded`: two people
    // exchanged codes in a room, so the app has finally earned the sentence
    // "verbunden mit".
    upsertPeer(s, {
      id: env.from.id,
      displayName: env.from.displayName,
      nonceSelf: self,
      noncePeer: env.nonce,
      connectedAt: Date.now(),
      blocked: false,
      seeded: false,
      did: env.did,
    })
    await saveState(s)
    // The pair key just changed (real nonces replace the seeded/placeholder
    // ones), and relay.ts's onEnvelope keeps only one registration -- a
    // stale key here means every inbound wire silently fails to decrypt and
    // is never acked. No-op in qr mode (no channel exists).
    await registerRelaySink()
    scanSucceeded(env.from.displayName)
    return { ok: true }
  }, () => go('connect'))
}

/**
 * Say, out loud, that the scan worked.
 *
 * Before this screen existed the camera view simply closed on a successful
 * scan and the app returned to a list. From the person holding the phone that
 * is indistinguishable from a crash, and it is what actually happened in
 * testing: "I scanned the code but I didn't see any confirmation."
 *
 * It also answers the question the other device cannot: in this mode nothing
 * travels over a network, so the phone showing the code has no way to learn
 * that it was read. The only way both sides end up sure is for the scan to go
 * both ways, so the primary action here is to show your own code back.
 */
function scanSucceeded(peerName: string): void {
  const body = el('div', {}, [
    el('div', { class: 'outcome shared' }, [
      el('div', { class: 'glyph' }, ['✓']),
      el('b', {}, [t('scanOkTitle')]),
      el('span', {}, [t('scanOkWith') + ' ' + peerName]),
    ]),
    el('p', {}, [t('scanOkNext')]),
    el('button', { class: 'btn primary', onclick: () => void showMyConnectCode() }, [t('showMyCode')]),
    wotMode() !== 'qr'
      ? el('button', { class: 'btn', onclick: () => go('link') }, [t('navChatNow')])
      : null,
    el('button', { class: 'btn quiet', onclick: () => go('home') }, [t('back')]),
  ])
  shell(t('navConnect'), body, { back: () => go('home') })
}

/**
 * Both sides must derive the same key. Two derivations, picked by
 * `p.pairing` (state.ts's doc comment on that field has the full
 * reasoning):
 *  - `'ecdh'` (the one-scan connect-link ceremony, connect_link.ts): X25519
 *    ECDH between this device's own relay identity and the peer's `did` --
 *    `nonceSelf`/`noncePeer` are unused placeholders for this peer.
 *  - absent/`'nonce'` (the original two-scan ceremony): HKDF over both
 *    nonces, canonically sorted since nonce order is not positional.
 */
async function pairKey(p: Peer): Promise<CryptoKey> {
  if (p.pairing === 'ecdh' && p.did && state) {
    const identity = await ensureRelayIdentity(state)
    return deriveEcdhPairKey(ecdhSharedSecret(identity, p.did))
  }
  const [a, b] = [p.nonceSelf, p.noncePeer].sort()
  return derivePairKey(a, b)
}

// ---------------------------------------------------------------------------
// webrtc ceremony (demo 3 / demo 6): two QR codes open a data channel, no
// server anywhere in the path. See webrtc.ts's module doc for the exact
// privacy claim and webrtc_sdp.ts for the QR-size feasibility measurement
// this whole approach rests on.
// ---------------------------------------------------------------------------

function getOrCreateWebrtcChannel(): NonNullable<typeof webrtcChannel> {
  if (webrtcChannel) return webrtcChannel
  const channel = createWebrtcChannel()
  channel.onStatus(() => updateWebrtcStatusBadge())
  channel.onEnvelope(handleIncomingEnvelope)
  webrtcChannel = channel
  return channel
}

/** Waits for the channel to reach a terminal state ('open' or 'failed').
 *  webrtc.ts's own CONNECT_TIMEOUT_MS already forces 'failed' eventually, so
 *  this never hangs -- it is purely "turn a status callback into a promise
 *  the ceremony screens can await". */
function waitForWebrtcTerminal(channel: NonNullable<typeof webrtcChannel>): Promise<WebrtcStatus> {
  const current = channel.status()
  if (current === 'open' || current === 'failed') return Promise.resolve(current)
  return new Promise((resolve) => {
    channel.onStatus((s) => {
      updateWebrtcStatusBadge()
      if (s === 'open' || s === 'failed') resolve(s)
    })
  })
}

async function startWebrtcOffer(): Promise<void> {
  const channel = getOrCreateWebrtcChannel()
  const offer = await channel.createOffer()
  const payload = encodeOfferPayload(offer)
  await showCodeScreen(t('webrtcShowOffer'), payload, t('webrtcOfferHint'), () => go('connect'), {
    label: t('webrtcScanAnswer'),
    action: () => void webrtcScanAnswer(channel),
  })
}

async function webrtcScanAnswer(channel: NonNullable<typeof webrtcChannel>): Promise<void> {
  await scanScreen(t('webrtcScanAnswer'), async (text) => {
    const decoded = decodeRtcPayload(text)
    if (!decoded) return { ok: false, msg: t('badCode') }
    if (decoded.kind !== 'rtc-answer') return { ok: false, msg: t('wrongCode') }
    await channel.acceptAnswer(decoded.sdp)
    void webrtcConnectingScreen(channel)
    return { ok: true }
  }, () => go('connect'))
}

async function startWebrtcAccept(): Promise<void> {
  await scanScreen(t('webrtcScanOffer'), async (text) => {
    const decoded = decodeRtcPayload(text)
    if (!decoded) return { ok: false, msg: t('badCode') }
    if (decoded.kind !== 'rtc-offer') return { ok: false, msg: t('wrongCode') }
    const channel = getOrCreateWebrtcChannel()
    const answer = await channel.acceptOffer(decoded.sdp)
    const payload = encodeAnswerPayload(answer)
    // A manual "next" tap, exactly like the offer side's "Antwort scannen" --
    // `showCodeScreen` renders and returns immediately (see showMyConnectCode's
    // identical usage), it does NOT wait for the code to actually be read. An
    // earlier version of this function called webrtcConnectingScreen()
    // straight after `await showCodeScreen(...)`, which replaced the answer
    // QR with the connecting screen before the other device had a chance to
    // scan it -- caught by the two-browser walk in
    // DEVLOG/result-report-webrtc-ladder.md, fixed here.
    await showCodeScreen(t('webrtcShowAnswer'), payload, t('webrtcAnswerHint'), () => go('connect'), {
      label: t('webrtcAnswerDone'),
      action: () => void webrtcConnectingScreen(channel),
    })
    return { ok: true }
  }, () => go('connect'))
}

/**
 * Shown after both descriptions are set, while ICE connectivity checks run.
 * Resolves to success (back to "Verbinden", badge now says "verbunden, kein
 * Server") or failure -- a real message plus the one-tap "über den Server
 * versuchen" escape hatch the handover specifically asks for, never a spinner
 * that just spins forever.
 */
async function webrtcConnectingScreen(channel: NonNullable<typeof webrtcChannel>): Promise<void> {
  const body = el('div', {}, [
    el('h1', {}, [t('webrtcConnecting')]),
    el('div', { class: 'card' }, [
      el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('webrtcConnecting'))]),
      mountWebrtcStatusBadge(),
    ]),
    el('button', { class: 'btn quiet', onclick: () => go('connect') }, [t('back')]),
  ])
  shell(t('webrtcCardTitle'), body, { back: () => go('connect') })

  const result = await waitForWebrtcTerminal(channel)
  if (result === 'open') {
    go('connect')
    return
  }
  screenWebrtcFailed()
}

function screenWebrtcFailed(): void {
  const body = el('div', {}, [
    el('div', { class: 'err' }, [
      el('b', {}, [t('webrtcFailedTitle')]),
      el('p', {}, [t('webrtcFailedBody')]),
    ]),
    el('button', {
      class: 'btn primary',
      onclick: () => { void ensureRelayFallback().then(() => go('connect')) },
    }, [t('webrtcTryServer')]),
    el('button', { class: 'btn quiet', onclick: () => go('connect') }, [t('webrtcBackToConnect')]),
  ])
  shell(t('webrtcCardTitle'), body, { back: () => go('connect') })
}

// ---------------------------------------------------------------------------
// graph (demo 20 only): the bubble view of Jakob's real trust graph.
//
// Plain SVG, no charting library -- the handover's own constraint, and
// legible from a couple of metres because the audience will be looking at
// this over Jakob's shoulder. Modelled on overnight/stub/trust-graph.html's
// concentric-ring layout (a dashed ring per hop, avatars as filled circles
// with initials, "Du" fixed in the centre): this keeps the same visual
// grammar -- ring distance means hop distance -- with a fraction of that
// stub's interactivity, because the query IS the demo, not the graph.
// ---------------------------------------------------------------------------

interface GraphBubble {
  id: string
  label: string
  ring: 1 | 2
  via?: string
  placeholder?: boolean
}

/** Seed nodes (data/geologengasse.ts) PLUS every real, accepted peer --
 *  reads `state.peers` directly rather than a separate list, which is what
 *  makes "the new person appears in the graph, live, without a reload" true
 *  by construction: render() already re-runs screenGraph() on every state
 *  change (acceptPendingRequest() calls it), so a peer accepted a moment
 *  ago is simply already in this array the next time this function runs. */
function graphBubbles(s: DeviceState): GraphBubble[] {
  const seeded: GraphBubble[] = SEED_GRAPH_NODES.map((n: GraphNode) => ({
    id: n.id,
    label: n.label[getLang()],
    ring: n.ring === 'ring2' ? 2 : 1,
    via: n.via,
    placeholder: n.placeholder,
  }))
  const live: GraphBubble[] = s.peers.map((p) => ({ id: p.id, label: p.displayName, ring: 1 }))
  return [...seeded, ...live]
}

function polarPercent(ring: 1 | 2, index: number, count: number, angleOffsetDeg = 0): { x: number; y: number } {
  const r = ring === 1 ? 32 : 44
  const step = 360 / Math.max(count, 1)
  const angleDeg = index * step + angleOffsetDeg - 90
  const rad = (angleDeg * Math.PI) / 180
  return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) }
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function screenGraph(): void {
  const s = state as DeviceState
  const bubbles = graphBubbles(s)
  const ring1 = bubbles.filter((b) => b.ring === 1)
  const ring2 = bubbles.filter((b) => b.ring === 2)
  const posOf = new Map<string, { x: number; y: number }>()
  ring1.forEach((b, i) => posOf.set(b.id, polarPercent(1, i, ring1.length)))
  ring2.forEach((b, i) => {
    // Anchor near the parent's angle rather than spreading independently --
    // "the distance in the picture should mean something" (handover): a
    // ring-2 node should read as "out past" its ring-1 connector, not as an
    // unrelated point on its own ring.
    const parent = b.via ? posOf.get(b.via) : undefined
    if (parent) {
      const angle = (Math.atan2(parent.y - 50, parent.x - 50) * 180) / Math.PI
      posOf.set(b.id, polarPercent(2, 0, 1, angle + 90))
    } else {
      posOf.set(b.id, polarPercent(2, i, ring2.length))
    }
  })

  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('class', 'geo-graph-svg')

  const ring = (r: number): void => {
    const c = document.createElementNS(svgNS, 'circle')
    c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', String(r))
    c.setAttribute('class', 'geo-ring')
    svg.appendChild(c)
  }
  ring(32); ring(44)

  for (const b of bubbles) {
    const pos = posOf.get(b.id)
    if (!pos) continue
    const from = b.via ? posOf.get(b.via) : { x: 50, y: 50 }
    if (!from) continue
    const line = document.createElementNS(svgNS, 'line')
    line.setAttribute('x1', String(from.x)); line.setAttribute('y1', String(from.y))
    line.setAttribute('x2', String(pos.x)); line.setAttribute('y2', String(pos.y))
    line.setAttribute('class', b.placeholder ? 'geo-thread geo-thread-placeholder' : 'geo-thread')
    svg.appendChild(line)
  }

  const nodeLayer = el('div', { class: 'geo-node-layer' })
  for (const b of bubbles) {
    const pos = posOf.get(b.id)
    if (!pos) continue
    nodeLayer.appendChild(el('div', {
      class: 'geo-node' + (b.placeholder ? ' geo-node-placeholder' : ''),
      style: `left:${pos.x}%;top:${pos.y}%`,
    }, [
      el('span', { class: 'geo-avatar' }, [b.placeholder ? '?' : initialsOf(b.label)]),
      el('span', { class: 'geo-name' }, [b.placeholder ? t('geoGraphUnknownNote').split('.')[0] : b.label]),
    ]))
  }

  const frame = el('div', { class: 'geo-graph-frame' }, [
    svg,
    nodeLayer,
    el('div', { class: 'geo-you' }, [
      el('span', { class: 'geo-avatar geo-avatar-you' }, [t('geoGraphYou').slice(0, 2)]),
      el('span', { class: 'geo-name' }, [t('geoGraphYou')]),
    ]),
  ])

  const body = el('div', {}, [
    el('h1', {}, [t('geoGraphTitle')]),
    el('p', { class: 'lead' }, [t('geoGraphLead')]),
    el('div', { class: 'card geo-graph-card' }, [frame]),
    el('p', { class: 'note' }, [t('geoGraphUnknownNote')]),
    ring2.length ? el('p', { class: 'note' }, [t('geoGraphRing2Note')]) : null,
    el('button', { class: 'btn quiet', onclick: () => go('home') }, [t('back')]),
  ])
  shell(t('geoGraphNav'), body, { back: () => go('home') })
}

// ---------------------------------------------------------------------------
// ask (person B)
// ---------------------------------------------------------------------------

/** Which query templates a screen offers: demo 20's own single "place to
 *  stay" template, or every other demo's five-template chat catalogue. Kept
 *  as one function used by both screenAsk() and runConsentCeremony()'s
 *  template lookup (via resolveTemplate()) so the two can never drift. */
function templatesForScenario(): QueryTemplate[] {
  return wotScenario() === 'geologengasse' ? [ACCOMMODATION_TEMPLATE] : TEMPLATES
}

/** getTemplate() (data/templates.ts) only knows the five chat templates --
 *  deliberately unchanged, see match/accommodation.ts's module doc on "do
 *  not fork the matcher". This resolves against whichever list the current
 *  scenario actually offers instead. */
function resolveTemplate(id: string): QueryTemplate | undefined {
  return templatesForScenario().find((tpl) => tpl.id === id) ?? getTemplate(id)
}

function screenAsk(): void {
  const s = state as DeviceState
  const lang = getLang()
  const peer = s.peers[0]
  const relayReady = wotMode() === 'relay' && Boolean(peer?.did)
  const webrtcNotOpen = (wotMode() === 'webrtc' || wotMode() === 'ladder') && !webrtcChannel?.isOpen()
  const body = el('div', {}, [
    el('h1', {}, [t('askTitle')]),
    el('p', { class: 'lead' }, [t('askLead')]),
    !peer ? el('div', { class: 'err' }, [t('noConnection')]) : null,
    peer && wotMode() === 'relay' && !relayReady
      ? el('p', { class: 'note' }, [t('relayNoPeerDid')])
      : null,
    // webrtc mode (demo 3): asking still works without the data channel --
    // it falls back to the same one-code-at-a-time QR path demo 1 uses (see
    // askWith's dispatch) -- this is informational, not a blocker.
    // Ladder mode (demo 6): no note needed, the automatic fall-through to
    // the relay is the point and the rung badge on the next screen says so.
    peer && wotMode() === 'webrtc' && webrtcNotOpen
      ? el('p', { class: 'note' }, [t('webrtcCardTitle') + ': ' + t('noConnection')])
      : null,
    ...templatesForScenario().map((tpl: QueryTemplate) =>
      el('div', { class: 'card' }, [
        el('h3', {}, [tpl.title[lang]]),
        el('p', {}, ['„' + tpl.question[lang] + '“']),
        wotScenario() === 'geologengasse' ? el('p', { class: 'note' }, [t('geoKHonesty')]) : null,
        el('button', {
          class: 'btn primary',
          ...(peer ? {} : { disabled: true }),
          onclick: () => void askWith(tpl),
        }, [t('showQuery')]),
      ]),
    ),
  ])
  shell(t('navAsk'), body, { back: () => go('home') })
}

async function askWith(tpl: QueryTemplate): Promise<void> {
  const s = state as DeviceState
  const peer = s.peers[0]
  if (!peer) return
  const q: QueryEnvelope = {
    v: 1, t: 'query', from: s.me,
    templateId: tpl.id, templateVersion: tpl.version,
    qid: randomId(12), issuedAt: Date.now(),
  }
  const mode = wotMode()
  if (mode === 'relay' && peer.did && relayChannel) {
    lastRung = 'relay'
    await askOverRelay(tpl, q, peer)
    return
  }
  // webrtc/ladder: rung 2 first, whenever the data channel is actually open --
  // this is the ladder's entire point, and demo 3's only transport once the
  // ceremony has succeeded.
  if ((mode === 'webrtc' || mode === 'ladder') && webrtcChannel?.isOpen()) {
    await askOverWebrtc(tpl, q, peer)
    return
  }
  // Ladder mode with no open data channel: reach for the server automatically
  // (rung 3), no human tap required -- that automatic reach, visibly labelled,
  // IS demo 6.
  if (mode === 'ladder' && peer.did && relayChannel) {
    await askOverRelayOrQr(tpl, q, peer)
    return
  }
  // Webrtc mode with no open channel: only use the relay if a human already
  // tapped "über den Server versuchen" during the connect ceremony -- demo 3
  // never reaches for a server on its own.
  if (mode === 'webrtc' && useRelayFallback && peer.did && relayChannel) {
    lastRung = 'relay'
    await askOverRelay(tpl, q, peer)
    return
  }
  lastRung = 'qr'
  await askViaQr(tpl, q, peer)
}

async function askViaQr(tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): Promise<void> {
  const payload = encodeForQr(q)
  await showCodeScreen(tpl.title[getLang()], payload, t('showQueryHint'), () => go('ask'), {
    label: t('waitAnswer'),
    action: () => void scanAnswer(q, peer),
  })
}

async function scanAnswer(q: QueryEnvelope, peer: Peer): Promise<void> {
  await scanScreen(t('waitAnswer'), async (text) => {
    const env = decodeFromQr(text)
    if (!env) return { ok: false, msg: t('badCode') }
    if (env.t !== 'answer') return { ok: false, msg: t('wrongCode') }
    if (env.qid !== q.qid) return { ok: false, msg: t('wrongCode') }
    const key = await pairKey(peer)
    const decoded = await interpret(env as AnswerEnvelope, key)
    pushReceivedShare(decoded)
    screenResult(decoded, peer.displayName)
    return { ok: true }
  }, () => go('ask'))
}

// ---------------------------------------------------------------------------
// ask over the relay -- sends the query, waits for the answer to arrive on
// the drain, and never blocks silently: a status badge, a hard timeout, a
// real error with retry, and the QR path one tap away at every step.
// ---------------------------------------------------------------------------

/**
 * Ladder mode's automatic rung-3 fall-through, reused by demo 2's own
 * (unchanged) relay-mode path via `askOverRelay` below. Ladder-only branch:
 * when even the relay has no did for this peer (should not happen once
 * `needsRelayIdentity()` has run, but a demo build should never hang on an
 * impossible state), falls all the way to the manual QR path -- rung 1.
 */
async function askOverRelayOrQr(tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): Promise<void> {
  if (peer.did && relayChannel) {
    lastRung = 'relay'
    await askOverRelay(tpl, q, peer)
    return
  }
  lastRung = 'qr'
  await askViaQr(tpl, q, peer)
}

async function askOverRelay(tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): Promise<void> {
  const peerDid = peer.did
  if (!peerDid || !relayChannel) { await askViaQr(tpl, q, peer); return }
  const channel = relayChannel

  const waiter = waitForAnswer(q.qid, RELAY_ANSWER_TIMEOUT_MS)
  const body = el('div', {}, [
    el('h1', {}, [tpl.title[getLang()]]),
    el('p', { class: 'lead' }, ['„' + tpl.question[getLang()] + '“']),
    el('div', { class: 'card' }, [
      el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('relayAskInFlight'))]),
      // Ladder mode only (demo 6) -- demo 2 never sets wotMode() === 'ladder',
      // so this line never renders there. The visible rung IS the demo.
      wotMode() === 'ladder' ? el('p', { class: 'note' }, [rungBadgeText('relay')]) : null,
      mountRelayStatusBadge(),
    ]),
    el('button', { class: 'btn quiet', onclick: () => { waiter.cancel(); void askViaQr(tpl, q, peer) } }, [t('showQrInstead')]),
    el('button', { class: 'btn quiet', onclick: () => { waiter.cancel(); go('ask') } }, [t('back')]),
  ])
  shell(t('navAsk'), body, { back: () => { waiter.cancel(); go('ask') } })

  let sendErr: Error | null = null
  const key = await pairKey(peer)
  try {
    await channel.send(peerDid, q, key)
  } catch (err) {
    sendErr = err instanceof Error ? err : new Error(String(err))
  }

  if (sendErr) {
    waiter.cancel()
    screenRelayAskError(t('relaySendFailed'), tpl, q, peer)
    return
  }

  const env = await waiter.promise
  if (!env) {
    screenRelayAskError(t('relayTimeout'), tpl, q, peer)
    return
  }
  const decoded = await interpret(env, key)
  pushReceivedShare(decoded)
  screenResult(decoded, peer.displayName)
}

function screenRelayAskError(msg: string, tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): void {
  const body = el('div', {}, [
    el('div', { class: 'err' }, [msg]),
    el('button', { class: 'btn primary', onclick: () => void askOverRelay(tpl, q, peer) }, [t('retry')]),
    el('button', { class: 'btn quiet', onclick: () => void askViaQr(tpl, q, peer) }, [t('showQrInstead')]),
    el('button', { class: 'btn quiet', onclick: () => go('ask') }, [t('back')]),
  ])
  shell(t('navAsk'), body, { back: () => go('ask') })
}

// ---------------------------------------------------------------------------
// ask over webrtc -- rung 2. Sends the query over the already-open data
// channel and waits for the answer on the SAME shared `awaitingAnswer` slot
// relay mode uses (handleIncomingEnvelope is registered as this channel's
// onEnvelope callback too, see getOrCreateWebrtcChannel) -- transport-
// agnostic by construction, exactly like gate.ts's envelopes themselves.
// ---------------------------------------------------------------------------

async function askOverWebrtc(tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): Promise<void> {
  const channel = webrtcChannel
  if (!channel || !channel.isOpen()) {
    if (wotMode() === 'ladder') { await askOverRelayOrQr(tpl, q, peer); return }
    lastRung = 'qr'
    await askViaQr(tpl, q, peer)
    return
  }
  lastRung = 'webrtc'

  const waiter = waitForAnswer(q.qid, WEBRTC_ANSWER_TIMEOUT_MS)
  const body = el('div', {}, [
    el('h1', {}, [tpl.title[getLang()]]),
    el('p', { class: 'lead' }, ['„' + tpl.question[getLang()] + '“']),
    el('div', { class: 'card' }, [
      el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('webrtcAskInFlight'))]),
      wotMode() === 'ladder' ? el('p', { class: 'note' }, [rungBadgeText('webrtc')]) : null,
    ]),
    el('button', { class: 'btn quiet', onclick: () => { waiter.cancel(); void askViaQr(tpl, q, peer) } }, [t('showQrInstead')]),
    el('button', { class: 'btn quiet', onclick: () => { waiter.cancel(); go('ask') } }, [t('back')]),
  ])
  shell(t('navAsk'), body, { back: () => { waiter.cancel(); go('ask') } })

  const key = await pairKey(peer)
  let sendErr: Error | null = null
  try {
    channel.send(q)
  } catch (err) {
    sendErr = err instanceof Error ? err : new Error(String(err))
  }

  if (sendErr) {
    waiter.cancel()
    if (wotMode() === 'ladder') { await askOverRelayOrQr(tpl, q, peer); return }
    screenWebrtcAskError(t('webrtcTimeout'), tpl, q, peer)
    return
  }

  const env = await waiter.promise
  if (!env) {
    if (wotMode() === 'ladder') { await askOverRelayOrQr(tpl, q, peer); return }
    screenWebrtcAskError(t('webrtcTimeout'), tpl, q, peer)
    return
  }
  const decoded = await interpret(env, key)
  pushReceivedShare(decoded)
  screenResult(decoded, peer.displayName)
}

/** Demo 3 only (never reached in ladder mode, which auto-falls-through
 *  instead -- see askOverWebrtc). Real message, a retry, the manual "über
 *  den Server versuchen" escape hatch (brings up the relay on first tap,
 *  same as the connect-ceremony failure screen), and the honest QR path. */
function screenWebrtcAskError(msg: string, tpl: QueryTemplate, q: QueryEnvelope, peer: Peer): void {
  const body = el('div', {}, [
    el('div', { class: 'err' }, [msg]),
    el('button', { class: 'btn primary', onclick: () => void askOverWebrtc(tpl, q, peer) }, [t('retry')]),
    el('button', {
      class: 'btn',
      onclick: () => { void ensureRelayFallback().then(() => askOverRelayOrQr(tpl, q, peer)) },
    }, [t('webrtcTryServer')]),
    el('button', { class: 'btn quiet', onclick: () => void askViaQr(tpl, q, peer) }, [t('showQrInstead')]),
    el('button', { class: 'btn quiet', onclick: () => go('ask') }, [t('back')]),
  ])
  shell(t('navAsk'), body, { back: () => go('ask') })
}

function screenResult(decoded: Awaited<ReturnType<typeof interpret>>, peerName: string): void {
  const shared = decoded.outcome === 'shared' ? decoded.shared : undefined
  // Same conversation the answering device now lands in after sending (see
  // sendAnswerOverRelay/sendAnswerOverWebrtc) -- he wants both devices to end
  // up in the chat, not just his own. Never offered in qr mode (demo 1),
  // which has no live link to land in at all.
  const canChat = wotMode() !== 'qr' && Boolean(state?.peers[0])
  const body = el('div', {}, [
    el('div', { class: 'outcome ' + (shared ? 'shared' : 'nothing') }, [
      el('div', { class: 'glyph' }, [shared ? '✓' : '—']),
      el('b', {}, [shared ? t('outShared') : t('outNothing')]),
      el('span', {}, [shared ? peerName + ' ' + t('outSharedSub') : t('outNothingSub')]),
    ]),
    ...(shared?.items ?? []).map((item) =>
      el('div', { class: 'quote' }, [
        item.text,
        el('footer', {}, [t('fromChat') + ' ' + item.context + ' · ' + item.when]),
      ]),
    ),
    // Ladder mode only (demo 6): which rung actually carried this exchange --
    // set by askWith()/askOverWebrtc()/askOverRelayOrQr() just before this
    // screen renders. This IS the demo: the point is not just that a rung 3
    // fallback exists, but that a person can SEE it happened.
    wotMode() === 'ladder' && lastRung ? el('p', { class: 'note' }, [rungBadgeText(lastRung)]) : null,
    el('button', { class: 'btn', onclick: () => go(canChat ? 'link' : 'home') }, [t('done')]),
  ])
  shell(t('navAsk'), body, { back: () => go('home') })
}

// ---------------------------------------------------------------------------
// answer (person A) -- the consent ceremony
// ---------------------------------------------------------------------------

function screenAnswer(): void {
  // Demo 20: several people can have queried Jakob; drain one at a time,
  // oldest first -- see pendingGeoQueries's doc comment.
  if (wotScenario() === 'geologengasse' && pendingGeoQueries.length) {
    const q = pendingGeoQueries.shift() as QueryEnvelope
    void runConsentCeremony(q)
    return
  }
  // A query that arrived over the relay while the user was elsewhere jumps
  // straight into the consent ceremony -- see handleIncomingEnvelope(). Read
  // once and cleared immediately so a later re-render of this same screen
  // (e.g. after go('answer') from somewhere else) does not replay it.
  if (pendingIncomingQuery) {
    const q = pendingIncomingQuery
    pendingIncomingQuery = null
    void runConsentCeremony(q)
    return
  }
  const s = state as DeviceState
  const peer = s.peers[0]
  const relayReady = wotMode() === 'relay' && Boolean(peer?.did)
  const body = el('div', {}, [
    el('h1', {}, [t('answerTitle')]),
    el('p', { class: 'lead' }, [t('connectLead')]),
    relayReady ? el('div', { class: 'card' }, [el('p', {}, [t('relayWaitingQuery')]), mountRelayStatusBadge()]) : null,
    wotMode() === 'relay' && !relayReady ? el('p', { class: 'note' }, [t('relayNoPeerDid')]) : null,
    el('button', { class: 'btn primary', onclick: () => void scanQuery() }, [
      relayReady ? t('scanInstead') : t('scanQuery'),
    ]),
  ])
  shell(t('navAnswer'), body, { back: () => go('home') })
}

async function scanQuery(): Promise<void> {
  await scanScreen(t('scanQuery'), async (text) => {
    const env = decodeFromQr(text)
    if (!env) return { ok: false, msg: t('badCode') }
    if (env.t !== 'query') return { ok: false, msg: t('wrongCode') }
    await runConsentCeremony(env as QueryEnvelope)
    return { ok: true }
  }, () => go('answer'))
}

/**
 * Keep only the hits that are actually about the question.
 *
 * The matcher scores generously on purpose, because recall matters more than
 * precision when deciding WHETHER there is anything here. But what a person is
 * asked to share, and what the asker then reads, should be the strong hits
 * only: a message that merely shares a district name with the real lead is
 * noise, and noise in that list makes the whole thing look careless.
 *
 * This narrows only what is previewed and shared. It deliberately does NOT
 * touch `aboveThreshold` or `distinctAuthors`, because those are the anonymity
 * decision, and that decision is made by the matcher over its own relevance
 * band. Narrowing what is shared must never narrow the floor that protects the
 * people who wrote it.
 */
const RELEVANCE_BAND = 0.5
const MAX_SHARED = 3

function prune(m: MatchResult): MatchResult {
  if (!m.hits.length) return m
  const top = m.hits[0].score
  const floor = top * RELEVANCE_BAND
  return { ...m, hits: m.hits.filter((h) => h.score >= floor).slice(0, MAX_SHARED) }
}

/** The accommodation template's hit carries the exact address in
 *  `hit.message.text` (match/accommodation.ts's module doc). That text must
 *  never reach the DOM before consent -- so this template gets no
 *  "Zeigen, was geteilt würde" reveal at all, ever, and the "gefunden" card
 *  shows only the address-free preview sentence instead. */
function isAddressBearingTemplate(tpl: QueryTemplate): boolean {
  return tpl.id === ACCOMMODATION_TEMPLATE_ID
}

async function runConsentCeremony(q: QueryEnvelope): Promise<void> {
  const s = state as DeviceState
  const tpl = resolveTemplate(q.templateId)
  const lang = getLang()
  const geo = wotScenario() === 'geologengasse'
  if (geo) geoCeremonyBusy = true

  // 1. A fixed-length "checking" beat. The match itself is far faster than this;
  //    the delay is here so the machine's answer time does not depend on whether
  //    anything was found.
  const t0 = Date.now()
  shell(t('navAnswer'), el('div', {}, [
    el('h1', {}, [q.from.displayName + ' ' + t('askedYou')]),
    el('p', { class: 'lead' }, ['„' + (tpl ? tpl.question[lang] : q.templateId) + '“']),
    el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('checking'))]),
  ]))

  let match: MatchResult = { hits: [], distinctAuthors: 0, aboveThreshold: false }
  if (tpl && isAddressBearingTemplate(tpl)) {
    // Not matchTemplate()/threadsInScope(): this corpus is a calendar and a
    // flat, not a chat -- see match/accommodation.ts's module doc on why
    // this is a second, separate matcher rather than a fork of the lexical
    // one gate.ts's every other caller still uses unmodified.
    match = matchAccommodation()
  } else if (tpl) {
    match = prune(matchTemplate(tpl, threadsInScope(s)))
  }
  await settleAt(t0, GATE_BUDGET_MS)

  if (!tpl) { geoCeremonyBusy = false; go('answer'); return }

  // 2. The ask. One tap either way, and the same page furniture either way.
  const peer = s.peers.find((p) => p.id === q.from.id) ?? null
  const has = match.aboveThreshold
  const addressBearing = isAddressBearingTemplate(tpl)

  let revealed = false
  const reveal = el('div', {})
  const renderReveal = () => {
    clear(reveal)
    if (!revealed) return
    for (const h of match.hits.slice(0, 3)) {
      reveal.appendChild(el('div', { class: 'quote' }, [
        h.message.text,
        el('footer', {}, [t('fromChat') + ' ' + h.threadTitle + ' · ' + coarseWhen(h.message.ts, lang)]),
      ]))
    }
  }

  const finish = (consent: boolean) => {
    void emitAnswer(q, tpl, match, consent, peer).finally(() => {
      // The decision has been made and the answer sent (or the send has
      // failed onto its own honest fallback screen) -- from here on a NEW
      // arriving query is safe to route to, not something to steal focus
      // from. See handleIncomingEnvelope's query branch.
      geoCeremonyBusy = false
    })
  }

  const body = el('div', {}, [
    el('h1', {}, [q.from.displayName + ' ' + t('askedYou')]),
    el('p', { class: 'lead' }, ['„' + tpl.question[lang] + '“']),
    el('div', { class: 'card' }, [
      el('p', { class: 'lead' }, [
        has ? (addressBearing ? (lang === 'de' ? accommodationPreviewDe() : accommodationPreviewEn()) : t('foundSomething')) : t('foundNothing'),
      ]),
      has ? el('p', {}, [t('willingShare')]) : null,
    ]),
    // The reveal toggle never renders for the address-bearing template --
    // see isAddressBearingTemplate()'s doc comment above. Every other
    // template keeps the exact existing behaviour.
    has && !addressBearing ? el('button', {
      class: 'btn quiet',
      onclick: (e: Event) => {
        revealed = !revealed
        ;(e.currentTarget as HTMLElement).textContent = revealed ? t('hideWhat') : t('seeWhat')
        renderReveal()
      },
    }, [t('seeWhat')]) : null,
    addressBearing ? null : reveal,
    has
      ? el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn', onclick: () => finish(false) }, [t('noShare')]),
          el('button', { class: 'btn primary', onclick: () => finish(true) }, [t('yesShare')]),
        ])
      : el('button', { class: 'btn primary', onclick: () => finish(false) }, [t('continueBtn')]),
  ])
  shell(t('navAnswer'), body, { back: () => go('answer') })
}

async function emitAnswer(
  q: QueryEnvelope,
  tpl: QueryTemplate,
  match: MatchResult,
  consent: boolean,
  peer: Peer | null,
): Promise<void> {
  const t0 = Date.now()
  shell(t('navAnswer'), el('div', {}, [
    el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('checking'))]),
  ]))
  // Without a peer record we cannot derive a key; treat it as blocked, which is
  // one of the four indistinguishable "nothing" reasons.
  const key = peer
    ? await pairKey(peer)
    : await derivePairKey(q.qid, q.qid)
  const { outcome, envelope } = await decide({
    query: q,
    template: tpl,
    match,
    consent,
    blocked: peer?.blocked ?? true,
    key,
  })
  await settleAt(t0, GATE_BUDGET_MS)

  // The transport choice below never depends on `outcome`/`consent` -- only
  // on whether we know a network address for this peer at all (which rung is
  // even reachable). Branching on the outcome here would reopen exactly the
  // side channel gate.ts's byte padding exists to close (see gate.ts's module
  // doc and this feature's wire-level test in relay.test.ts). That discipline
  // holds across every rung added below, not just the original relay branch.
  // `outcome` is threaded through to the send functions purely so THEY can
  // append a LOCAL chat-log entry strictly AFTER the network send has
  // already gone out (see pushLocalShare's own doc comment) -- it never
  // changes which branch below fires or how long any of them take before
  // sending.
  const mode = wotMode()
  if (mode === 'relay' && peer?.did && relayChannel) {
    await sendAnswerOverRelay(envelope, peer, key, outcome, tpl, match)
    return
  }
  if ((mode === 'webrtc' || mode === 'ladder') && webrtcChannel?.isOpen()) {
    await sendAnswerOverWebrtc(envelope, outcome, tpl, match)
    return
  }
  if (mode === 'ladder' && peer?.did && relayChannel) {
    await sendAnswerOverRelay(envelope, peer, key, outcome, tpl, match)
    return
  }
  if (mode === 'webrtc' && useRelayFallback && peer?.did && relayChannel) {
    await sendAnswerOverRelay(envelope, peer, key, outcome, tpl, match)
    return
  }
  const payload = encodeForQr(envelope)
  await showCodeScreen(t('showAnswer'), payload, t('answerHint'), () => go('home'), undefined, t('identicalNote'))
}

/**
 * Local-only record of what THIS device just shared, for the chat screen's
 * "Wohnung geteilt" card -- never sent over any wire (chat-signal handover,
 * item 2: "do NOT invent a second transport"). Callers must only invoke this
 * strictly AFTER the answer envelope has already been handed to the
 * transport (see sendAnswerOverRelay/sendAnswerOverWebrtc below): building
 * this list costs CPU proportional to `match.hits.length`, and doing that
 * work before the send -- inside the outcome-independent path emitAnswer
 * above is careful to keep flat -- would reopen a timing side channel the
 * asker could in principle observe. Doing it after the send is invisible to
 * them: the bytes already left.
 */
function pushLocalShare(tpl: QueryTemplate, match: MatchResult): void {
  chatLog.push({
    kind: 'shared',
    mine: true,
    at: Date.now(),
    shared: {
      from: state?.me.displayName ?? '',
      templateId: tpl.id,
      items: match.hits.map((h) => ({
        text: h.message.text,
        when: coarseWhen(h.message.ts, getLang()),
        context: h.threadTitle,
      })),
    },
  })
}

/** The asker's mirror of pushLocalShare: the decoded answer already crossed
 *  the wire (that IS the transport -- see the handover's "let the existing
 *  answer... carry it"), so this only ever turns something already
 *  delivered into a chat-log entry. A `nothing` outcome pushes nothing,
 *  same as it renders nothing on screenResult. */
function pushReceivedShare(decoded: DecodedAnswer): void {
  if (decoded.outcome === 'shared' && decoded.shared) {
    chatLog.push({ kind: 'shared', mine: false, at: Date.now(), shared: decoded.shared })
  }
}

/**
 * Rung 2's answer send. No outer AES-GCM wrap here (unlike
 * `sendAnswerOverRelay`, whose `channel.send` re-encrypts under `pairKey` for
 * the relay operator's benefit) -- the data channel is already DTLS-secured
 * end to end, and `envelope.body` is already gate.ts's own AEAD ciphertext
 * regardless of transport. This just moves the same JSON `encodeForQr`
 * produces for a QR code, over the open channel instead.
 */
async function sendAnswerOverWebrtc(
  envelope: AnswerEnvelope,
  outcome: LocalOutcome,
  tpl: QueryTemplate,
  match: MatchResult,
): Promise<void> {
  const channel = webrtcChannel
  if (!channel || !channel.isOpen()) {
    // Should not happen given the gating in emitAnswer() above, but a demo
    // must never hang on an impossible state -- fall back to the honest QR.
    const payload = encodeForQr(envelope)
    await showCodeScreen(t('showAnswer'), payload, t('answerHint'), () => go('home'), undefined, t('identicalNote'))
    return
  }
  try {
    channel.send(envelope)
  } catch {
    const payload = encodeForQr(envelope)
    await showCodeScreen(
      t('showAnswer'), payload,
      t('webrtcTimeout') + ' ' + t('answerHint'),
      () => go('home'), undefined, t('identicalNote'),
    )
    return
  }
  // Strictly after the send above -- see pushLocalShare's doc comment.
  if (outcome === 'shared') pushLocalShare(tpl, match)
  // Same "sent" screen shape (and the SAME strings) as sendAnswerOverRelay --
  // identical wording and structure regardless of outcome (I3), and
  // transport-neutral wording since both rungs use it.
  const body = el('div', {}, [
    el('div', { class: 'outcome shared' }, [
      el('div', { class: 'glyph' }, ['✓']),
      el('b', {}, [t('relayAnswerSent')]),
      el('span', {}, [t('relayAnswerSentSub')]),
    ]),
    el('p', {}, [t('identicalNote')]),
    el('button', {
      class: 'btn quiet',
      onclick: () => void showCodeScreen(t('showAnswer'), encodeForQr(envelope), t('answerHint'), () => go('home'), undefined, t('identicalNote')),
    }, [t('showQrInstead')]),
    // He asked for this to land him in the conversation, not home: the next
    // thing he does in real life is tell the person the exact house number.
    // See DEVLOG/handover-chat-signal.md item 1.
    el('button', { class: 'btn', onclick: () => go('link') }, [t('done')]),
  ])
  shell(t('navAnswer'), body, { back: () => go('home') })
}

async function sendAnswerOverRelay(
  envelope: AnswerEnvelope,
  peer: Peer,
  pairKeyForPeer: CryptoKey,
  outcome: LocalOutcome,
  tpl: QueryTemplate,
  match: MatchResult,
): Promise<void> {
  const peerDid = peer.did as string
  try {
    await (relayChannel as RelayChannel).send(peerDid, envelope, pairKeyForPeer)
  } catch {
    // Delivery failed outright (network down, relay unreachable) -- this is
    // a transport fact, not a content signal, and it is equally possible
    // regardless of outcome. Fall back to the honest QR path rather than
    // claiming a delivery that did not happen.
    const payload = encodeForQr(envelope)
    await showCodeScreen(
      t('showAnswer'), payload,
      t('relaySendFailed') + ' ' + t('answerHint'),
      () => go('home'), undefined, t('identicalNote'),
    )
    return
  }
  // Strictly after the send above -- see pushLocalShare's doc comment.
  if (outcome === 'shared') pushLocalShare(tpl, match)
  // This confirmation screen is the SAME for every outcome -- it only ever
  // says "sent", never what was sent or whether anything was found.
  const moreQueued = wotScenario() === 'geologengasse' && pendingGeoQueries.length > 0
  const body = el('div', {}, [
    el('div', { class: 'outcome shared' }, [
      el('div', { class: 'glyph' }, ['✓']),
      el('b', {}, [t('relayAnswerSent')]),
      el('span', {}, [t('relayAnswerSentSub')]),
    ]),
    el('p', {}, [t('identicalNote')]),
    el('button', {
      class: 'btn quiet',
      onclick: () => void showCodeScreen(t('showAnswer'), encodeForQr(envelope), t('answerHint'), () => go('home'), undefined, t('identicalNote')),
    }, [t('showQrInstead')]),
    // Demo 20: another person's question is already queued -- offer to go
    // straight to it instead of forcing a detour through home. Never
    // renders for any other demo (pendingGeoQueries is always empty there).
    moreQueued
      ? el('button', { class: 'btn primary', onclick: () => go('answer') }, [t('geoNextQuery')])
      : null,
    // Land in the conversation, not home -- see the item-1 note above.
    el('button', { class: 'btn', onclick: () => go('link') }, [t('done')]),
  ])
  shell(t('navAnswer'), body, { back: () => go('home') })
}

// ---------------------------------------------------------------------------
// shared sub-screens: show a code, scan a code
// ---------------------------------------------------------------------------

async function showCodeScreen(
  title: string,
  payload: string,
  hint: string,
  back: () => void,
  next?: { label: string; action: () => void },
  footnote?: string,
): Promise<void> {
  // data-payload lets the headless end-to-end test read the code without a
  // camera. It is the same string the QR encodes and the same string the copy
  // button copies, so the test exercises the real wire format.
  const wrap = el('div', { class: 'qrwrap', 'data-payload': payload })
  const body = el('div', {}, [
    el('h1', {}, [title]),
    el('p', { class: 'lead' }, [hint]),
    wrap,
    next ? el('button', { class: 'btn primary', onclick: next.action }, [next.label]) : null,
    el('button', { class: 'btn quiet', onclick: () => void copyText(payload) }, [t('copyCode')]),
    footnote ? el('div', { class: 'note' }, [footnote]) : null,
    el('button', { class: 'btn quiet', onclick: back }, [t('back')]),
  ])
  shell(title, body, { back })
  await renderQr(wrap, payload)
  releaseWake = await keepAwake()
}

async function copyText(s: string): Promise<void> {
  try { await navigator.clipboard.writeText(s); alert(t('copied')) }
  catch { prompt(t('copyCode'), s) }
}

type ScanOutcome = { ok: true } | { ok: false; msg: string }

async function scanScreen(
  title: string,
  onText: (text: string) => Promise<ScanOutcome>,
  back: () => void,
): Promise<void> {
  const video = el('video', { class: 'scanner', playsinline: true, muted: true }) as HTMLVideoElement
  const errBox = el('div', {})
  const pasteArea = el('textarea', {
    rows: 3,
    placeholder: t('pasteHere'),
    style: 'width:100%;border-radius:14px;border:1px solid var(--line);background:var(--bg-raised);color:var(--ink);padding:12px;font:inherit;margin-bottom:12px',
  }) as HTMLTextAreaElement

  const busy = el('div', { class: 'busy', style: 'display:none' }, [t('scanCaught')])
  const hint = el('p', {}, [t('scanning')])

  /**
   * The black-box fix.
   *
   * `scanQr` calls `stop()` the instant it decodes, which stops the camera
   * tracks -- so the <video> element is left showing a dead black rectangle.
   * Whatever happens next can take seconds (accepting a WebRTC offer gathers
   * ICE candidates before it can produce an answer), and during that time the
   * screen said nothing at all. Reported from a real phone as "I scanned the
   * code and then the camera box went black".
   *
   * So the moment a code is caught, the camera view is replaced by a line that
   * says it was caught and something is happening. On failure the camera comes
   * back with the error; on success the caller navigates away.
   */
  const showBusy = (on: boolean): void => {
    busy.style.display = on ? '' : 'none'
    video.style.display = on ? 'none' : ''
    hint.style.display = on ? 'none' : ''
  }

  const handle = async (text: string, restart: boolean): Promise<void> => {
    clear(errBox)
    showBusy(true)
    let r: ScanOutcome
    try {
      r = await onText(text.trim())
    } catch (err) {
      // An exception here used to surface as nothing at all. It is the most
      // likely outcome when a peer connection cannot be established.
      r = { ok: false, msg: `${t('scanFailed')} ${err instanceof Error ? err.message : String(err)}` }
    }
    if (!r.ok) {
      showBusy(false)
      errBox.appendChild(el('div', { class: 'err' }, [r.msg]))
      // The error box sits above the camera view, which on a phone is often
      // scrolled out of sight by the time a scan fails. An error nobody sees
      // is the same as no error at all.
      errBox.scrollIntoView({ block: 'center', behavior: 'smooth' })
      if (restart) start()
    }
  }

  let stop: () => void = () => {}
  const start = () => {
    showBusy(false)
    if (!cameraPlausible()) {
      clear(errBox)
      errBox.appendChild(el('div', { class: 'err' }, [t('camDenied')]))
      video.style.display = 'none'
      return
    }
    const h = scanQr(video, (text) => { void handle(text, true) })
    stop = h.stop
    h.ready.catch(() => {
      clear(errBox)
      errBox.appendChild(el('div', { class: 'err' }, [t('camDenied')]))
      video.style.display = 'none'
    })
  }

  const body = el('div', {}, [
    el('h1', {}, [title]),
    errBox,
    video,
    busy,
    hint,
    el('h2', {}, [t('camPaste')]),
    pasteArea,
    el('button', { class: 'btn', onclick: () => void handle(pasteArea.value, false) }, [t('useCode')]),
    el('button', { class: 'btn quiet', onclick: () => { stop(); back() } }, [t('back')]),
  ])
  shell(title, body, { back: () => { stop(); back() } })
  start()
}

// ---------------------------------------------------------------------------
// the live link: a conversation and a probe
//
// Neither is part of the query protocol. They exist because "Verbunden (seit
// 09:57:33)" is a claim, and a person holding two devices has no way to check
// it. Typing a word on one and watching it appear on the other is proof; the
// probe puts a number next to it. Both travel the same path a query would, so
// if these work the query path works.
// ---------------------------------------------------------------------------

function screenLink(): void {
  unreadChat = 0
  const s = state as DeviceState
  const peer = s.peers[0]
  // Shown once, right after a confirmation, on whichever side just learned
  // about it. A connection that completes silently reads as one that did not
  // complete at all -- the whole reason this banner exists.
  const banner = justAccepted
    ? el('div', { class: 'outcome shared' }, [
        el('div', { class: 'glyph' }, ['\u2713']),
        el('b', {}, [t('linkNowConnected')]),
        el('span', {}, [t('scanOkWith') + ' ' + justAccepted]),
      ])
    : null
  justAccepted = null

  const result = el('div', {})
  const say = (node: HTMLElement): void => { clear(result); result.appendChild(node) }

  const send = (text: string): void => {
    chatLog.push({ kind: 'text', mine: true, text, at: Date.now() })
    render()
    void sendOverActiveTransport({ v: 1, t: 'chat', from: s.me, text, ts: Date.now() }).catch((err: unknown) => {
      chatLog.push({
        kind: 'text',
        mine: true,
        text: t('linkSendFailed') + ' ' + (err instanceof Error ? err.message : ''),
        at: Date.now(),
      })
      render()
    })
  }

  const test = async (): Promise<void> => {
    const id = randomId(10)
    say(el('p', {}, [el('span', { class: 'spin' }), document.createTextNode(' ' + t('linkTesting'))]))
    const ms = await new Promise<number | null>((resolve) => {
      pendingPing = { id, sentAt: Date.now(), resolve: (v) => resolve(v) }
      const timer = setTimeout(() => { pendingPing = null; resolve(null) }, 10000)
      void sendOverActiveTransport({ v: 1, t: 'ping', id, back: false })
        .then((rung) => { lastTestRung = rung })
        .catch(() => { clearTimeout(timer); pendingPing = null; resolve(null) })
    })
    pendingPing = null
    if (ms === null) {
      say(el('div', { class: 'err' }, [t('linkTestFailed')]))
      return
    }
    say(el('div', { class: 'outcome shared' }, [
      el('div', { class: 'glyph' }, ['\u2713']),
      el('b', {}, [t('linkTestOk')]),
      el('span', {}, [`${ms} ms \u00b7 ${lastTestRung === 'webrtc' ? t('linkViaDirect') : t('linkViaServer')}`]),
    ]))
  }

  // Which of i18n.ts's two existing honesty strings actually describes this
  // conversation right now: webrtc when the direct channel is open (demo
  // 3/6), relay otherwise (demo 2/20). Never a new claim of its own -- see
  // renderSecurityInfo's doc comment.
  const securityExplain = webrtcChannel?.isOpen() ? t('webrtcExplain') : t('relayExplain')

  const body = el('div', {}, [
    el('h1', {}, [peer?.displayName ?? t('navLink')]),
    banner,
    el('div', { class: 'chat-toolbar' }, [
      el('button', { class: 'btn quiet', onclick: () => void test() }, [t('linkTestBtn')]),
      renderSecurityInfo(securityExplain),
    ]),
    result,
    renderMessageList(chatLog, resolveTemplate),
    renderComposer(t('linkPlaceholder'), send),
  ])
  shell(t('navLink'), body, { back: () => go('home') })
}

let lastTestRung: 'webrtc' | 'relay' = 'relay'

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

/**
 * Register the offline worker. Never let it break the boot: if registration
 * fails for any reason, the app must still start.
 */
function registerWorker(): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return
  window.addEventListener('load', () => {
    // BASE_URL, not document.baseURI: without a <base> tag baseURI is the page
    // URL, so visiting the app without its trailing slash would resolve the
    // worker one directory too high. Same class of bug as the relative asset
    // paths that shipped a black page to a phone.
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => undefined)
  })
}

/**
 * Disarm the blank-page tripwire in index.html. Called as boot's first act:
 * from here on the app owns what is on screen, so the tripwire's six-second
 * deadline must not fire over a perfectly healthy demo.
 */
function markBooted(): void {
  const w = window as Window & { __wotBooted?: () => void }
  try { w.__wotBooted?.() } catch { /* the tripwire is a safety net, never a dependency */ }
}

/**
 * Last-resort error screen, built with raw DOM and inline styles on purpose:
 * it must render even when the module that normally draws screens is the thing
 * that failed. A demo that dies must say why on the device holding it — a
 * black page in someone's hand is the worst possible failure mode.
 */
function bootFailed(err: unknown): void {
  const app = document.getElementById('app')
  if (!app) return
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  app.innerHTML = ''
  const box = document.createElement('div')
  box.setAttribute('style', 'padding:24px;font:15px/1.55 system-ui,sans-serif;color:#e9eef4')
  const h = document.createElement('h1')
  h.setAttribute('style', 'font-size:20px;margin:0 0 10px')
  h.textContent = 'Die Demo konnte nicht starten.'
  const p = document.createElement('p')
  p.setAttribute('style', 'color:#9fb0c0;margin:0 0 14px')
  p.textContent = 'Bitte diesen Text abfotografieren und weitergeben:'
  const pre = document.createElement('pre')
  pre.setAttribute('style', 'white-space:pre-wrap;word-break:break-word;background:#171d24;border:1px solid #28323d;border-radius:10px;padding:12px;font-size:12.5px;color:#e9eef4')
  pre.textContent = [
    detail,
    `secureContext: ${String(window.isSecureContext)}`,
    `indexedDB: ${(() => { try { return globalThis.indexedDB ? 'present' : 'absent' } catch { return 'blocked' } })()}`,
    `localStorage: ${(() => { try { void localStorage.length; return 'present' } catch { return 'blocked' } })()}`,
    `ua: ${navigator.userAgent}`,
  ].join('\n')
  box.append(h, p, pre)
  app.appendChild(box)
}

async function boot(): Promise<void> {
  markBooted()
  registerWorker()
  initI18n()
  state = await loadState()
  // Demo 20: "no persona picker" on the laptop (handover) means the laptop
  // never shows screenStart() at all. The one case that reaches boot() with
  // no state AND no pending connect link IS the laptop opening this build
  // for the first time -- an invited phone always arrives WITH a connect
  // link (screenGeoNameEntry handles that case via the ordinary
  // `screen = 'start'` path below). Auto-seeding here, rather than adding a
  // silent branch inside screenStart(), is what keeps screenStart() itself
  // simple: by the time it could ever render in this scenario, a connect
  // link is always pending.
  if (!state && wotScenario() === 'geologengasse' && !pendingConnectLink) {
    await seedJakob()
  }
  screen = state ? 'home' : 'start'
  render()
  // A returning session (state already on disk) that ALSO happens to have
  // opened this tab via a fresh connect link -- unusual (the ordinary case
  // is a brand-new phone, handled in seedPersona() instead, since a
  // first-visit device has no state yet for boot() to find), but a device
  // already paired to someone else can still be re-pointed at a new peer
  // this way. Otherwise: fire-and-forget, a returning session opens its
  // relay drain in the background while the home screen renders
  // immediately. Both are no-ops in qr mode; `initRelaySession()` is also a
  // no-op when state is null (first visit -- seedPersona() opens it once a
  // persona is picked instead).
  if (state && pendingConnectLink) {
    void completeConnectLinkIfPending()
  } else {
    void initRelaySession()
  }
}

void boot().catch((err: unknown) => {
  console.error('[boot] fatal', err)
  bootFailed(err)
})
