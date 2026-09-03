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
import { derivePairKey, randomId } from './crypto'
import { encodeForQr, decodeFromQr } from './wire'
import type { Envelope } from './wire'
import { SEED_DIRECT_IOS } from './data/seed_direct'
import seedGroupRaw from './data/seed-wien-wohnen.txt?raw'
import type { ChatThread, QueryEnvelope, AnswerEnvelope, MatchResult, QueryTemplate } from './types'
import { wotMode } from './mode'
import { createRelayChannel } from './relay'
import type { RelayChannel, RelayStatus } from './relay'
import { ensureRelayIdentity } from './relay_identity'
import { createWebrtcChannel, decodeRtcPayload, encodeAnswerPayload, encodeOfferPayload } from './webrtc'
import type { WebrtcChannel, WebrtcStatus } from './webrtc'

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

const root = document.getElementById('app') as HTMLElement
let state: DeviceState | null = null
let releaseWake: () => void = () => {}

type Screen = 'start' | 'home' | 'chats' | 'profile' | 'inventory' | 'connect' | 'ask' | 'answer'
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
 *  user has navigated to 'answer' themselves; screenAnswer() consumes it. */
let pendingIncomingQuery: QueryEnvelope | null = null
/** The one query this device is currently waiting on an answer for, if any. */
let awaitingAnswer: { qid: string; resolve: (env: AnswerEnvelope) => void } | null = null

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

/** (Re-)registers the drain sink for the current peer's pair key. Must be
 *  called again whenever that key can have changed -- a real connect
 *  ceremony overwrites nonceSelf/noncePeer, and onEnvelope() only ever keeps
 *  one registration (relay.ts), so a stale key here means inbound wires
 *  silently fail to decrypt and are never acked. */
async function registerRelaySink(): Promise<void> {
  if (!relayChannel || !state) return
  const peer = state.peers[0]
  if (!peer) return
  const key = await pairKey(peer)
  relayChannel.onEnvelope(key, handleIncomingEnvelope)
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
    // Nothing here narrows this to the peer that is actually paired -- the
    // demo pairs exactly one peer at a time (state.ts's Peer[0] convention),
    // so any arriving query is by construction from that one peer.
    pendingIncomingQuery = env
    go('answer')
    return
  }
  // A ConnectEnvelope never travels over the relay in this app -- pairing is
  // QR-only (handover's Task 2/3 split) -- so this is unreachable in
  // practice; ignored rather than asserted, matching wire.ts's "never throw
  // on unexpected shape" posture.
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
  root.append(bar, el('main', {}, [body]))
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
    default:        return screenHome()
  }
}

// ---------------------------------------------------------------------------
// start: pick a persona, seed the device
// ---------------------------------------------------------------------------

function screenStart(): void {
  const lang = getLang()
  const body = el('div', {}, [
    el('h1', {}, [t('whoAreYou')]),
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
  void initRelaySession()
  go('home')
}

/** Fixed demo nonces so both devices start out already paired. See seedPersona. */
const DEMO_NONCE: Record<string, string> = {
  marlene0: 'demo-nonce-marlene-2026',
  nora0000: 'demo-nonce-nora-2026',
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

function screenHome(): void {
  const s = state as DeviceState
  const peer = s.peers[0]
  const body = el('div', {}, [
    el('h1', {}, [t('appName')]),
    el('div', { class: 'card' }, [
      el('h3', {}, [t('navConnect')]),
      el('p', {}, [peerStatusLine(peer)]),
      peer?.seeded ? el('p', { class: 'seeded' }, [t('seededNote')]) : null,
      el('button', { class: 'btn', onclick: () => go('connect') }, [t('navConnect')]),
    ]),
    el('button', { class: 'btn primary', onclick: () => go('ask') }, [t('navAsk')]),
    el('button', { class: 'btn', onclick: () => go('answer') }, [t('navAnswer')]),
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
  const body = el('div', {}, [
    el('h1', {}, [t('connectTitle')]),
    el('p', { class: 'lead' }, [t('connectLead')]),
    relay ? el('p', { class: 'note' }, [t('relayExplain')]) : null,
    relay ? el('div', { class: 'card' }, [mountRelayStatusBadge()]) : null,
    wotMode() === 'ladder' ? el('p', { class: 'note' }, [t('ladderExplain')]) : null,
    peer ? el('div', { class: 'card' }, [
      el('h3', {}, [peerStatusLine(peer)]),
      peer.seeded
        ? el('p', { class: 'seeded' }, [t('seededNote')])
        : el('p', {}, [new Date(peer.connectedAt).toLocaleString(getLang() === 'de' ? 'de-AT' : 'en-GB')]),
    ]) : null,
    el('button', { class: 'btn primary', onclick: () => void showMyConnectCode() }, [t('showMyCode')]),
    el('button', { class: 'btn', onclick: () => void scanConnectCode() }, [t('scanTheirCode')]),
    webrtc && peer ? el('div', { class: 'card' }, [
      el('h3', {}, [t('webrtcCardTitle')]),
      el('p', { class: 'note' }, [t('webrtcExplain')]),
      mountWebrtcStatusBadge(),
      el('button', { class: 'btn', onclick: () => void startWebrtcOffer() }, [t('webrtcOfferBtn')]),
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
  await showCodeScreen(t('showMyCode'), payload, t('connectLead'), () => go('connect'))
  // Remember our own nonce so a later scan can complete the pair.
  const p = s.peers[0]
  if (p) { p.nonceSelf = nonce; await saveState(s) }
  else { pendingSelfNonce = nonce }
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
    el('button', { class: 'btn quiet', onclick: () => go('home') }, [t('back')]),
  ])
  shell(t('navConnect'), body, { back: () => go('home') })
}

/** Both sides must derive the same key, so the nonce order is canonical, not positional. */
async function pairKey(p: Peer): Promise<CryptoKey> {
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
// ask (person B)
// ---------------------------------------------------------------------------

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
    ...TEMPLATES.map((tpl: QueryTemplate) =>
      el('div', { class: 'card' }, [
        el('h3', {}, [tpl.title[lang]]),
        el('p', {}, ['„' + tpl.question[lang] + '“']),
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
    el('button', { class: 'btn', onclick: () => go('home') }, [t('done')]),
  ])
  shell(t('navAsk'), body, { back: () => go('home') })
}

// ---------------------------------------------------------------------------
// answer (person A) -- the consent ceremony
// ---------------------------------------------------------------------------

function screenAnswer(): void {
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

async function runConsentCeremony(q: QueryEnvelope): Promise<void> {
  const s = state as DeviceState
  const tpl = getTemplate(q.templateId)
  const lang = getLang()

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
  if (tpl) match = prune(matchTemplate(tpl, threadsInScope(s)))
  await settleAt(t0, GATE_BUDGET_MS)

  if (!tpl) { go('answer'); return }

  // 2. The ask. One tap either way, and the same page furniture either way.
  const peer = s.peers.find((p) => p.id === q.from.id) ?? null
  const has = match.aboveThreshold

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

  const finish = (consent: boolean) => void emitAnswer(q, tpl, match, consent, peer)

  const body = el('div', {}, [
    el('h1', {}, [q.from.displayName + ' ' + t('askedYou')]),
    el('p', { class: 'lead' }, ['„' + tpl.question[lang] + '“']),
    el('div', { class: 'card' }, [
      el('p', { class: 'lead' }, [has ? t('foundSomething') : t('foundNothing')]),
      has ? el('p', {}, [t('willingShare')]) : null,
    ]),
    has ? el('button', {
      class: 'btn quiet',
      onclick: (e: Event) => {
        revealed = !revealed
        ;(e.currentTarget as HTMLElement).textContent = revealed ? t('hideWhat') : t('seeWhat')
        renderReveal()
      },
    }, [t('seeWhat')]) : null,
    reveal,
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
  const { envelope } = await decide({
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
  const mode = wotMode()
  if (mode === 'relay' && peer?.did && relayChannel) {
    await sendAnswerOverRelay(envelope, peer, key)
    return
  }
  if ((mode === 'webrtc' || mode === 'ladder') && webrtcChannel?.isOpen()) {
    await sendAnswerOverWebrtc(envelope)
    return
  }
  if (mode === 'ladder' && peer?.did && relayChannel) {
    await sendAnswerOverRelay(envelope, peer, key)
    return
  }
  if (mode === 'webrtc' && useRelayFallback && peer?.did && relayChannel) {
    await sendAnswerOverRelay(envelope, peer, key)
    return
  }
  const payload = encodeForQr(envelope)
  await showCodeScreen(t('showAnswer'), payload, t('answerHint'), () => go('home'), undefined, t('identicalNote'))
}

/**
 * Rung 2's answer send. No outer AES-GCM wrap here (unlike
 * `sendAnswerOverRelay`, whose `channel.send` re-encrypts under `pairKey` for
 * the relay operator's benefit) -- the data channel is already DTLS-secured
 * end to end, and `envelope.body` is already gate.ts's own AEAD ciphertext
 * regardless of transport. This just moves the same JSON `encodeForQr`
 * produces for a QR code, over the open channel instead.
 */
async function sendAnswerOverWebrtc(envelope: AnswerEnvelope): Promise<void> {
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
    el('button', { class: 'btn', onclick: () => go('home') }, [t('done')]),
  ])
  shell(t('navAnswer'), body, { back: () => go('home') })
}

async function sendAnswerOverRelay(envelope: AnswerEnvelope, peer: Peer, pairKeyForPeer: CryptoKey): Promise<void> {
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
  // This confirmation screen is the SAME for every outcome -- it only ever
  // says "sent", never what was sent or whether anything was found.
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
    el('button', { class: 'btn', onclick: () => go('home') }, [t('done')]),
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

  const handle = async (text: string, restart: boolean): Promise<void> => {
    const r = await onText(text.trim())
    if (!r.ok) {
      clear(errBox)
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
    if (!cameraPlausible()) {
      clear(errBox)
      errBox.appendChild(el('div', { class: 'err' }, [t('camDenied')]))
      return
    }
    const h = scanQr(video, (text) => { void handle(text, true) })
    stop = h.stop
    h.ready.catch(() => {
      clear(errBox)
      errBox.appendChild(el('div', { class: 'err' }, [t('camDenied')]))
    })
  }

  const body = el('div', {}, [
    el('h1', {}, [title]),
    errBox,
    video,
    el('p', {}, [t('scanning')]),
    el('h2', {}, [t('camPaste')]),
    pasteArea,
    el('button', { class: 'btn', onclick: () => void handle(pasteArea.value, false) }, [t('useCode')]),
    el('button', { class: 'btn quiet', onclick: () => { stop(); back() } }, [t('back')]),
  ])
  shell(title, body, { back: () => { stop(); back() } })
  start()
}

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
  screen = state ? 'home' : 'start'
  render()
  // Fire-and-forget: a returning session (state already on disk) opens its
  // relay drain in the background while the home screen renders immediately.
  // A no-op in qr mode and a no-op when state is null (first visit --
  // seedPersona() opens it once a persona is picked instead).
  void initRelaySession()
}

void boot().catch((err: unknown) => {
  console.error('[boot] fatal', err)
  bootFailed(err)
})
