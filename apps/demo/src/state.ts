/**
 * Device state. Lives in IndexedDB, never leaves the device.
 */

import type { ChatThread, Identity, InventoryItem, Profile } from './types'
import { kvGet, kvSet, kvClear } from './db'
import { randomId } from './crypto'

export interface Peer {
  id: string
  displayName: string
  /** Our nonce and theirs, in the fixed order that derives the shared key. */
  nonceSelf: string
  noncePeer: string
  connectedAt: number
  blocked: boolean
  /**
   * True while this pairing came from the demo seed rather than from a QR
   * ceremony two people actually performed.
   *
   * The seeded pairing stays (a camera that misbehaves must not cost us the
   * part of the demo that matters), but the UI must never render it as
   * "Verbunden mit Marlene". Claiming a connection that did not happen is the
   * one thing that would make everything else we say about this app suspect.
   * Cleared the moment a real ceremony completes.
   */
  seeded?: boolean
}

export interface DeviceState {
  me: Identity
  threads: ChatThread[]
  peers: Peer[]
  profile: Profile
  inventory: InventoryItem[]
}

/** Exported so test/state_defaults.test.ts can write a legacy-shaped record
 * to the same slot loadState() reads from, without hardcoding the string
 * twice and silently drifting if this ever changes. */
export const KEY = 'device'

function emptyProfile(displayName: string): Profile {
  return { displayName, bio: '', neighbourhood: '', languages: [] }
}

/**
 * The two demo personas.
 *
 * Deliberately mundane: a neighbourhood group and someone looking for a flat.
 * There is no subculture framing here and there must not be -- the audience is
 * two people in Vienna who want to know whether this is safe to use.
 */
export const PERSONAS: {
  id: string
  displayName: string
  role: 'holder' | 'seeker'
  blurb: { de: string; en: string }
  profile: Profile
  /**
   * Starting entries for "Was ich habe". Nora gets none: she is the seeker,
   * not the holder, and an empty list is itself the honest demo state for
   * her, not a gap to fill.
   */
  inventorySeed: Omit<InventoryItem, 'id' | 'createdAt'>[]
}[] = [
  {
    id: 'marlene0',
    displayName: 'Marlene',
    role: 'holder',
    blurb: {
      de: 'Ist in einer Grätzl-Gruppe im 16. Bezirk. Hat den Chatverlauf auf dem Handy.',
      en: 'Is in a neighbourhood group in the 16th district. Has the chat history on her phone.',
    },
    profile: {
      displayName: 'Marlene',
      bio: 'Wohnt seit über zehn Jahren im Grätzl, kennt viele in der Nachbarschaft und hilft gern aus.',
      neighbourhood: 'Ottakring, 16. Bezirk',
      languages: ['Deutsch', 'Englisch'],
    },
    inventorySeed: [
      // Phrased to fire the T1 pre-listing template's 'wohnung frei'
      // matchTerm (see data/templates.ts) so the demo-critical beat --
      // type a line, then find that line -- works without adding a
      // template. See test/inventory_match.test.ts.
      {
        text: 'Ich wohn im Erdgeschoß direkt neben der Hausverwaltung und krieg oft als Erste mit, wenn im Haus eine Wohnung frei wird.',
        included: true,
      },
      { text: 'Hab eine Bohrmaschine daheim, kannst sie dir jederzeit ausborgen.', included: true },
      { text: 'Hab ein Lastenrad, praktisch fürs Möbeltransportieren, frag einfach kurz.', included: true },
    ],
  },
  {
    id: 'nora0000',
    displayName: 'Nora',
    role: 'seeker',
    blurb: {
      de: 'Sucht eine Wohnung. Kennt Marlene, aber nicht ihre Gruppen.',
      en: 'Is looking for a flat. Knows Marlene, but not her groups.',
    },
    profile: {
      displayName: 'Nora',
      bio: 'Ist neu in Wien und sucht eine leistbare Wohnung.',
      neighbourhood: 'Wohnt vorübergehend bei einer Freundin in Meidling',
      languages: ['Deutsch', 'Englisch'],
    },
    inventorySeed: [],
  },
]

let cached: DeviceState | null = null

/**
 * Fill in fields a state saved by an earlier build of the demo won't have.
 * `inventory`/`profile` did not exist before this change, so a state loaded
 * from IndexedDB (or the in-memory fallback, see db.ts) can legally be
 * missing them; every reader in this module and in main.ts assumes they are
 * present, so this is the one place that guarantee gets made, rather than
 * every call site defending itself with `s.inventory ?? []`.
 */
function withDefaults(s: DeviceState): DeviceState {
  return {
    ...s,
    inventory: s.inventory ?? [],
    profile: s.profile ?? emptyProfile(s.me.displayName),
  }
}

export async function loadState(): Promise<DeviceState | null> {
  if (cached) return cached
  const s = await kvGet<DeviceState>(KEY)
  cached = s ? withDefaults(s) : null
  return cached
}

export async function saveState(s: DeviceState): Promise<void> {
  cached = s
  await kvSet(KEY, s)
}

export async function resetAll(): Promise<void> {
  cached = null
  await kvClear()
  // Also drop the offline cache and the worker, so "Demo zurücksetzen" really
  // does return the device to a first-visit state rather than to a cached one.
  try {
    if ('caches' in globalThis) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    const regs = await navigator.serviceWorker?.getRegistrations?.()
    if (regs) await Promise.all(regs.map((r) => r.unregister()))
  } catch { /* nothing here may block a reset */ }
}

/**
 * A fixed, non-translated label. Treated the same way as an imported chat's
 * title ('Klaus', 'Otta Grätzl & Alltag'): a name-like tag on the synthetic
 * thread, not UI chrome, so it stays out of i18n.ts and does not change with
 * the language toggle -- exactly like every other ChatThread.title.
 */
const INVENTORY_THREAD_TITLE = 'Eigene Notizen'

/**
 * Represent "Was ich habe" as matcher input: one synthetic single-message
 * ChatThread per entry, so match/lexical.ts needs no second scoring path for
 * inventory content. From the matcher's point of view an entry is
 * indistinguishable from a message she sent in a one-message thread with
 * herself -- same normalize/stem/compound pipeline, same exclude-term veto,
 * same author-counted anonymity floor (an entry always contributes exactly
 * the one author who wrote it, same as if she had posted it in a group chat
 * herself). `included` on the synthetic thread mirrors the entry's own
 * switch; matchTemplate's own `thread.included !== true` guard (see
 * match/lexical.ts) is what actually keeps an excluded entry unmatchable,
 * this function does not pre-filter, on purpose -- see threadsInScope below.
 */
function inventoryThreads(s: DeviceState): ChatThread[] {
  return s.inventory.map((item) => ({
    id: `inv:${item.id}`,
    title: INVENTORY_THREAD_TITLE,
    kind: 'direct',
    participants: [s.me.displayName],
    messages: [{ ts: item.createdAt, author: s.me.displayName, text: item.text, system: false }],
    source: 'self',
    included: item.included,
  }))
}

/**
 * Everything currently eligible to be matched against an incoming question:
 * imported chat threads AND "Was ich habe" entries, both filtered to
 * `included`. This is the ONLY function main.ts's consent ceremony calls
 * before matchTemplate -- widening it here, instead of adding a second
 * argument or a second call, is what keeps inventory entries on the exact
 * same scoring path as chat messages (see inventoryThreads' doc comment).
 * Filtering here is belt-and-suspenders on top of matchTemplate's own
 * `included` guard, matching the existing double-filter for chat threads.
 */
export function threadsInScope(s: DeviceState): ChatThread[] {
  return [...s.threads, ...inventoryThreads(s)].filter((t) => t.included)
}

export function findPeer(s: DeviceState, id: string): Peer | undefined {
  return s.peers.find((p) => p.id === id)
}

/**
 * Upsert a peer, keeping the earliest connectedAt so the trust history stays
 * honest.
 *
 * One exception: replacing a SEEDED pairing. Its `connectedAt` is the moment
 * the app was opened, not a moment two people met, so carrying it forward
 * would backdate a real connection to a fictional one. A real ceremony
 * overwriting a seeded peer therefore keeps its own timestamp -- the earliest
 * *genuine* connection is still the one that survives.
 */
export function upsertPeer(s: DeviceState, p: Peer): void {
  const i = s.peers.findIndex((x) => x.id === p.id)
  if (i >= 0) {
    const prior = s.peers[i]
    s.peers[i] = { ...p, connectedAt: prior.seeded ? p.connectedAt : prior.connectedAt }
  } else {
    s.peers.push(p)
  }
}

/**
 * Append a new "Was ich habe" entry. Defaults to included: she typed this in
 * on purpose, just now -- see InventoryItem.included's doc comment in
 * types.ts for why that default is the opposite of a 1-on-1 chat's.
 */
export function addInventoryItem(s: DeviceState, text: string): InventoryItem {
  const item: InventoryItem = {
    id: randomId(8),
    text,
    createdAt: new Date().toISOString(),
    included: true,
  }
  s.inventory.push(item)
  return item
}

/**
 * Reassigns `s.inventory` rather than mutating it in place (unlike
 * `upsertPeer`/`addInventoryItem` above). Safe because every reader goes
 * through `s` itself and `saveState(s)` persists the whole object -- but
 * worth flagging as the one exception to this module's usual mutate-in-place
 * style, in case a future caller ever holds a separate reference to the
 * array.
 */
export function removeInventoryItem(s: DeviceState, id: string): void {
  s.inventory = s.inventory.filter((i) => i.id !== id)
}
