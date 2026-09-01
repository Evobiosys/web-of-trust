/** Tiny DOM helpers. No framework: the whole app must survive a cold phone. */

type Attrs = Record<string, string | boolean | number | ((e: Event) => void)>

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    } else if (k === 'class') {
      node.className = String(v)
    } else if (v === true) {
      node.setAttribute(k, '')
    } else {
      node.setAttribute(k, String(v))
    }
  }
  for (const c of children) {
    if (c === null || c === undefined) continue
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

export function clear(node: HTMLElement): void { node.replaceChildren() }

/** Coarse German date label: we share "mid August", never a timestamp. */
export function coarseWhen(iso: string, lang: 'de' | 'en'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return lang === 'de' ? 'vor Kurzem' : 'recently'
  const day = d.getDate()
  const part = day <= 10 ? 0 : day <= 20 ? 1 : 2
  const monthsDe = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
  const monthsEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const m = (lang === 'de' ? monthsDe : monthsEn)[d.getMonth()]
  if (lang === 'de') return ['Anfang', 'Mitte', 'Ende'][part] + ' ' + m
  return ['early', 'mid', 'late'][part] + ' ' + m
}
