/**
 * "Mein Profil" -- who this person is, visible only on their own device.
 *
 * This module builds the screen BODY only; main.ts's screenProfile() wraps
 * it in the shared `shell()` chrome and owns navigation. Kept as a separate
 * module, per the handover, so main.ts's own diff stays a few lines.
 *
 * Privacy: nothing here writes into a QueryEnvelope or AnswerEnvelope.
 * gate.ts's GateInput has no `profile` field -- there is no path from this
 * screen to a requester at all in this build, let alone one that skips
 * consent. See test/gate_profile_privacy.test.ts.
 */

import { el } from '../ui/dom'
import { t } from '../i18n'
import type { DeviceState } from '../state'

function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return el('div', { class: 'field' }, [el('label', {}, [label]), input, hint ? el('small', {}, [hint]) : null])
}

/**
 * `onSave` persists a field edit in place, same as chats.ts's threadRow: no
 * draft state, no explicit save button. `onIdentityChange` additionally
 * asks the caller to redraw the surrounding chrome -- used ONLY by the
 * display-name field, because that is the one field the topbar and the
 * connect screen also read (`state.me.displayName`). The other three fields
 * call `onSave` alone: a full-screen rerender on every blur is a needless
 * risk to in-progress keyboard/tab focus for no visible benefit, since
 * nothing outside this screen shows bio/Grätzl/languages.
 */
export function renderProfile(s: DeviceState, onSave: () => void, onIdentityChange: () => void): HTMLElement {
  const p = s.profile

  const nameInput = el('input', { type: 'text', value: p.displayName }) as HTMLInputElement
  nameInput.addEventListener('change', () => {
    const v = nameInput.value.trim()
    if (!v) { nameInput.value = p.displayName; return } // never let the display name go empty
    // Kept in lockstep with `me.displayName`: the topbar and the connect
    // ceremony both read `me`, and showing one name there while this screen
    // shows another would look like a bug mid-demo, not a feature.
    p.displayName = v
    s.me.displayName = v
    onIdentityChange()
  })

  const bioInput = el('textarea', { rows: 3 }) as HTMLTextAreaElement
  bioInput.value = p.bio
  bioInput.addEventListener('change', () => { p.bio = bioInput.value.trim(); onSave() })

  const graetzlInput = el('input', { type: 'text', value: p.neighbourhood }) as HTMLInputElement
  graetzlInput.addEventListener('change', () => { p.neighbourhood = graetzlInput.value.trim(); onSave() })

  const langsInput = el('input', { type: 'text', value: p.languages.join(', ') }) as HTMLInputElement
  langsInput.addEventListener('change', () => {
    p.languages = langsInput.value
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
    onSave()
  })

  return el('div', {}, [
    el('p', { class: 'lead' }, [t('profileLead')]),
    field(t('profileName'), nameInput),
    field(t('profileBio'), bioInput),
    field(t('profileGraetzl'), graetzlInput),
    field(t('profileLangs'), langsInput, t('profileLangsHint')),
  ])
}
