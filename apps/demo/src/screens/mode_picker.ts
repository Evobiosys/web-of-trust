/**
 * The three-mode picker (DEVLOG/handover-three-modes.md), shared by every
 * place a mode is chosen or shown: the persona-picker start screen and both
 * guest name-entry screens (main.ts -- onboarding, all inline on the SAME
 * screen the person is already on, so choosing a mode costs no extra tap
 * beyond what "als Marlene"/"Anfrage senden" already was), Jakob's own
 * laptop bootstrap (main.ts's screenModePick, demo 20/21 only), and "Mein
 * Profil" (screens/profile.ts, where it is changeable afterwards and the
 * current choice is visible without hunting for it).
 *
 * Kept as its own module, same reasoning screens/profile.ts's own header
 * gives, so a change to the copy or the layout of this one picker cannot
 * silently drift between the five places it appears.
 *
 * The German copy says what HAPPENS TO THE PERSON, not which switch it
 * flips (handover's own instruction) -- "du bekommst", "du kannst",
 * "deine Antwort", never "free-text queries enabled".
 */

import { el } from '../ui/dom'
import { t } from '../i18n'
import type { Mode } from '../state'

const MODES: Mode[] = ['sicher', 'standard', 'pro']

/** Title/tagline/description i18n keys per mode, so main.ts and
 *  screens/profile.ts can both render "the current mode" as one short
 *  string without duplicating a switch statement. */
export function modeTitleKey(mode: Mode): string {
  switch (mode) {
    case 'sicher': return 'modeSicherTitle'
    case 'pro': return 'modeProTitle'
    case 'standard': default: return 'modeStandardTitle'
  }
}

function modeTaglineKey(mode: Mode): string {
  switch (mode) {
    case 'sicher': return 'modeSicherTagline'
    case 'pro': return 'modeProTagline'
    case 'standard': default: return 'modeStandardTagline'
  }
}

function modeDescKey(mode: Mode): string {
  switch (mode) {
    case 'sicher': return 'modeSicherDesc'
    case 'pro': return 'modeProDesc'
    case 'standard': default: return 'modeStandardDesc'
  }
}

/**
 * `radioGroupName` must be unique per screen instance so two pickers can
 * never render on the same page at once and fight over `name` (never
 * happens today, kept explicit rather than relying on that).
 *
 * `onChange` fires with the newly selected mode; it does not itself
 * re-render anything -- every caller either reads the current selection
 * later (at "weiter"/submit time, the onboarding screens) or persists and
 * redraws its own surrounding chrome immediately (the profile screen).
 */
export function renderModePicker(
  current: Mode,
  onChange: (m: Mode) => void,
  radioGroupName = 'wot-mode',
): HTMLElement {
  return el('div', { class: 'modepicker' }, MODES.map((m) => {
    const id = `${radioGroupName}-${m}`
    const radio = el('input', {
      type: 'radio',
      name: radioGroupName,
      id,
      ...(m === current ? { checked: true } : {}),
      onchange: () => onChange(m),
    }) as HTMLInputElement
    return el('label', { for: id, class: 'card modecard', style: 'display:block;cursor:pointer' }, [
      el('div', { style: 'display:flex;align-items:baseline;gap:10px' }, [
        radio,
        el('h3', { style: 'margin:0' }, [t(modeTitleKey(m))]),
        m === 'standard' ? el('small', { class: 'note' }, [t('modeDefaultBadge')]) : null,
      ]),
      el('p', { class: 'note', style: 'margin:4px 0 0 26px' }, [t(modeTaglineKey(m))]),
      el('p', { style: 'margin:8px 0 0 26px' }, [t(modeDescKey(m))]),
    ])
  }))
}
