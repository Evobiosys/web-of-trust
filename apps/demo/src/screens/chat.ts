/**
 * The live chat, Signal-shaped: right-aligned tinted bubbles for mine,
 * left-aligned neutral for theirs, a "what was shared" card, and the
 * security info disclosure. Builds DOM only -- main.ts's screenLink() still
 * owns `chatLog` itself (pushed to from several places: an incoming chat
 * envelope, the composer's send, the sharer's own consent, the receiver's
 * decoded answer), the shell() chrome, and navigation. Kept as its own
 * module, per the chat-signal handover, so main.ts's diff for this feature
 * stays small -- same reasoning as screens/profile.ts's own header comment.
 */

import { el } from '../ui/dom'
import { t, getLang } from '../i18n'
import type { QueryTemplate, SharedPayload } from '../types'

export type ChatLogEntry =
  | { kind: 'text'; mine: boolean; text: string; at: number }
  | { kind: 'shared'; mine: boolean; shared: SharedPayload; at: number }

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(getLang() === 'de' ? 'de-AT' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Most template titles are short noun phrases ("Wohnung wird frei (vor
 * Inserat)") that read fine with " geteilt" appended. One does not: demo
 * 20's ACCOMMODATION_TEMPLATE title is a literal question ("Bleibt euch die
 * Wohnung offen?"), and "Bleibt euch die Wohnung offen? geteilt" reads as
 * broken German. Map by `category` instead for the templates this app
 * actually ships (data/templates.ts, match/accommodation.ts) -- exactly the
 * owner's own words for the one being demoed today ("Wohnung geteilt") --
 * and fall back to the raw title for anything not in the map, so a future
 * template never crashes this, it just reads slightly less polished.
 */
const CATEGORY_LABEL: Record<string, { de: string; en: string }> = {
  accommodation: { de: 'Wohnung', en: 'the flat' },
  housing: { de: 'Wohnung', en: 'the flat' },
  health: { de: 'Ärztin/Arzt', en: 'the doctor' },
  services: { de: 'Handwerk', en: 'the tradesperson' },
  childcare: { de: 'Betreuungsplatz', en: 'the childcare place' },
}

function sharedLabel(shared: SharedPayload, resolveTemplate: (id: string) => QueryTemplate | undefined): string {
  const lang = getLang()
  const tpl = resolveTemplate(shared.templateId)
  const subject = tpl ? (CATEGORY_LABEL[tpl.category]?.[lang] ?? tpl.title[lang]) : t('outShared')
  return subject + ' ' + t('chatSharedLabel')
}

function sharedBubble(
  entry: Extract<ChatLogEntry, { kind: 'shared' }>,
  resolveTemplate: (id: string) => QueryTemplate | undefined,
): HTMLElement {
  return el('div', { class: 'bubble shared ' + (entry.mine ? 'mine' : 'theirs') }, [
    el('div', { class: 'bubble-shared-head' }, ['\u{1F3E0} ' + sharedLabel(entry.shared, resolveTemplate)]),
    ...entry.shared.items.map((item) =>
      el('div', { class: 'bubble-shared-item' }, [
        item.text,
        el('div', { class: 'bubble-shared-meta' }, [t('fromChat') + ' ' + item.context + ' · ' + item.when]),
      ]),
    ),
    el('span', { class: 'bubble-time' }, [formatTime(entry.at)]),
  ])
}

function textBubble(entry: Extract<ChatLogEntry, { kind: 'text' }>): HTMLElement {
  return el('div', { class: 'bubble ' + (entry.mine ? 'mine' : 'theirs') }, [
    entry.text,
    el('span', { class: 'bubble-time' }, [formatTime(entry.at)]),
  ])
}

/**
 * The message list. Signal's *layout*: one row per entry, right-aligned and
 * tinted for mine, left-aligned and neutral for theirs -- not Signal's
 * palette (app.css's `--chat-accent` is teal-petrol, chosen per the
 * handover). Empty state is the same wording the old "stack of quote
 * blocks" screen used.
 */
export function renderMessageList(
  log: ChatLogEntry[],
  resolveTemplate: (id: string) => QueryTemplate | undefined,
): HTMLElement {
  if (!log.length) return el('p', {}, [t('linkEmpty')])
  return el(
    'div',
    { class: 'chat-log' },
    log.map((entry) =>
      el('div', { class: 'bubble-row ' + (entry.mine ? 'mine' : 'theirs') }, [
        entry.kind === 'shared' ? sharedBubble(entry, resolveTemplate) : textBubble(entry),
      ]),
    ),
  )
}

/**
 * One field, the send action beside it -- not a full-width button
 * underneath, which is most of why the old screen read as a debugging tool
 * rather than a conversation. `onSend` gets the trimmed, length-capped text;
 * this module never touches a transport, matching every other screens/*.ts
 * module's separation from main.ts's networking.
 */
export function renderComposer(placeholder: string, onSend: (text: string) => void): HTMLElement {
  const input = el('textarea', { rows: 1, placeholder, class: 'composer-field' }) as HTMLTextAreaElement
  const submit = (): void => {
    const text = input.value.trim().slice(0, 500)
    if (!text) return
    input.value = ''
    onSend(text)
  }
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  })
  return el('div', { class: 'composer' }, [
    input,
    el('button', { class: 'send', 'aria-label': t('linkSendBtn'), onclick: submit }, ['➤']),
  ])
}

/**
 * The "how is this secured" disclosure: a native <details>, no modal
 * plumbing needed. `explain` is one of i18n.ts's existing relay/webrtc
 * honesty strings (relayExplain / webrtcExplain), chosen by the caller from
 * whichever transport is actually carrying this conversation right now --
 * this module never writes its own security claim, per the handover.
 */
export function renderSecurityInfo(explain: string): HTMLElement {
  return el('details', { class: 'chat-info' }, [
    el('summary', {}, ['ⓘ ' + t('chatInfoBtn')]),
    el('div', { class: 'chat-info-body' }, [explain]),
  ])
}
