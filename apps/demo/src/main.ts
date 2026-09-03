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
import { SEED_DIRECT_IOS } from './data/seed_direct'
import seedGroupRaw from './data/seed-wien-wohnen.txt?raw'
import type { ChatThread, QueryEnvelope, AnswerEnvelope, MatchResult, QueryTemplate } from './types'

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

const root = document.getElementById('app') as HTMLElement
let state: DeviceState | null = null
let releaseWake: () => void = () => {}

type Screen = 'start' | 'home' | 'chats' | 'profile' | 'inventory' | 'connect' | 'ask' | 'answer'
let screen: Screen = 'start'

function shell(title: string, body: HTMLElement, opts: { back?: () => void } = {}): void {
  releaseWake()
  releaseWake = () => {}
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
  const body = el('div', {}, [
    el('h1', {}, [t('connectTitle')]),
    el('p', { class: 'lead' }, [t('connectLead')]),
    peer ? el('div', { class: 'card' }, [
      el('h3', {}, [peerStatusLine(peer)]),
      peer.seeded
        ? el('p', { class: 'seeded' }, [t('seededNote')])
        : el('p', {}, [new Date(peer.connectedAt).toLocaleString(getLang() === 'de' ? 'de-AT' : 'en-GB')]),
    ]) : null,
    el('button', { class: 'btn primary', onclick: () => void showMyConnectCode() }, [t('showMyCode')]),
    el('button', { class: 'btn', onclick: () => void scanConnectCode() }, [t('scanTheirCode')]),
  ])
  shell(t('navConnect'), body, { back: () => go('home') })
}

function myNonce(): string {
  const s = state as DeviceState
  const existing = s.peers[0]?.nonceSelf
  return existing ?? randomId(16)
}

async function showMyConnectCode(): Promise<void> {
  const s = state as DeviceState
  const nonce = myNonce()
  const payload = encodeForQr({ v: 1, t: 'connect', from: s.me, nonce })
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
    })
    await saveState(s)
    go('connect')
    return { ok: true }
  }, () => go('connect'))
}

/** Both sides must derive the same key, so the nonce order is canonical, not positional. */
async function pairKey(p: Peer): Promise<CryptoKey> {
  const [a, b] = [p.nonceSelf, p.noncePeer].sort()
  return derivePairKey(a, b)
}

// ---------------------------------------------------------------------------
// ask (person B)
// ---------------------------------------------------------------------------

function screenAsk(): void {
  const s = state as DeviceState
  const lang = getLang()
  const peer = s.peers[0]
  const body = el('div', {}, [
    el('h1', {}, [t('askTitle')]),
    el('p', { class: 'lead' }, [t('askLead')]),
    !peer ? el('div', { class: 'err' }, [t('noConnection')]) : null,
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
    el('button', { class: 'btn', onclick: () => go('home') }, [t('done')]),
  ])
  shell(t('navAsk'), body, { back: () => go('home') })
}

// ---------------------------------------------------------------------------
// answer (person A) -- the consent ceremony
// ---------------------------------------------------------------------------

function screenAnswer(): void {
  const body = el('div', {}, [
    el('h1', {}, [t('answerTitle')]),
    el('p', { class: 'lead' }, [t('connectLead')]),
    el('button', { class: 'btn primary', onclick: () => void scanQuery() }, [t('scanQuery')]),
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
  const payload = encodeForQr(envelope)
  await showCodeScreen(t('showAnswer'), payload, t('answerHint'), () => go('home'), undefined, t('identicalNote'))
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
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch(() => undefined)
  })
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
  registerWorker()
  initI18n()
  state = await loadState()
  screen = state ? 'home' : 'start'
  render()
}

void boot().catch((err: unknown) => {
  console.error('[boot] fatal', err)
  bootFailed(err)
})
