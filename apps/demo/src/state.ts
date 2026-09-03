/**
 * Device state. Lives in IndexedDB, never leaves the device.
 */

import type { ChatThread, Identity } from './types'
import { kvGet, kvSet, kvClear } from './db'

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
}

const KEY = 'device'

/**
 * The two demo personas.
 *
 * Deliberately mundane: a neighbourhood group and someone looking for a flat.
 * There is no subculture framing here and there must not be -- the audience is
 * two people in Vienna who want to know whether this is safe to use.
 */
export const PERSONAS: { id: string; displayName: string; role: 'holder' | 'seeker'; blurb: { de: string; en: string } }[] = [
  {
    id: 'marlene0',
    displayName: 'Marlene',
    role: 'holder',
    blurb: {
      de: 'Ist in einer Grätzl-Gruppe im 16. Bezirk. Hat den Chatverlauf auf dem Handy.',
      en: 'Is in a neighbourhood group in the 16th district. Has the chat history on her phone.',
    },
  },
  {
    id: 'nora0000',
    displayName: 'Nora',
    role: 'seeker',
    blurb: {
      de: 'Sucht eine Wohnung. Kennt Marlene, aber nicht ihre Gruppen.',
      en: 'Is looking for a flat. Knows Marlene, but not her groups.',
    },
  },
]

let cached: DeviceState | null = null

export async function loadState(): Promise<DeviceState | null> {
  if (cached) return cached
  const s = await kvGet<DeviceState>(KEY)
  cached = s ?? null
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

export function threadsInScope(s: DeviceState): ChatThread[] {
  return s.threads.filter((t) => t.included)
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
