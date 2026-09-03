/**
 * "Was ich habe" -- entries she writes herself, matched alongside her chats.
 *
 * Visual language mirrors chats.ts's threadRow in main.ts on purpose (the
 * `.thread`/`.sw` classes, the inline included/excluded switch, an in-place
 * label update rather than a full rerender on toggle): this screen is meant
 * to read as "the same kind of list", not a bespoke one.
 *
 * Matching: entries do NOT run through a second matcher. state.ts's
 * threadsInScope() turns every included entry into a synthetic ChatThread
 * and hands it to the exact same matchTemplate() call chats already go
 * through -- see threadsInScope's doc comment in state.ts. There is nothing
 * in this file that scores anything.
 */

import { el } from '../ui/dom'
import { t } from '../i18n'
import { addInventoryItem, removeInventoryItem } from '../state'
import type { DeviceState } from '../state'
import type { InventoryItem } from '../types'

function entryRow(
  s: DeviceState,
  item: InventoryItem,
  onChange: () => void,
  rerender: () => void,
): HTMLElement {
  const box = el('input', { type: 'checkbox', ...(item.included ? { checked: true } : {}) }) as HTMLInputElement
  const stateLabel = el('small', {}, [item.included ? t('included') : t('excluded')])
  box.addEventListener('change', () => {
    item.included = box.checked
    onChange()
    stateLabel.textContent = item.included ? t('included') : t('excluded')
  })

  const removeBtn = el(
    'button',
    {
      class: 'remove',
      onclick: () => {
        removeInventoryItem(s, item.id)
        onChange()
        rerender()
      },
    },
    [t('removeEntry')],
  )

  return el('div', { class: 'thread entry' }, [
    el('div', { class: 'meta' }, [el('p', {}, [item.text]), stateLabel, removeBtn]),
    el('label', { class: 'sw' }, [box, el('span', {})]),
  ])
}

export function renderInventory(s: DeviceState, onChange: () => void, rerender: () => void): HTMLElement {
  const newText = el('input', { type: 'text', placeholder: t('inventoryPh') }) as HTMLInputElement

  const submit = (): void => {
    const v = newText.value.trim()
    if (!v) return
    addInventoryItem(s, v)
    onChange()
    rerender()
  }
  newText.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') submit()
  })

  return el('div', {}, [
    el('p', { class: 'lead' }, [t('inventoryLead')]),
    ...(s.inventory.length
      ? s.inventory.map((item) => entryRow(s, item, onChange, rerender))
      : [el('p', {}, [t('inventoryEmpty')])]),
    el('div', { class: 'field' }, [newText]),
    el('button', { class: 'btn primary', onclick: submit }, [t('addEntry')]),
  ])
}
