/**
 * The seeded-pairing disclosure.
 *
 * The demo ships already paired so a misbehaving camera cannot cost us the
 * part of the demo that matters. That convenience is only acceptable while the
 * app says so, and while a real ceremony can still take over cleanly. Both of
 * those are invariants, so both are tested.
 */
import { describe, it, expect } from 'vitest'
import { upsertPeer } from '../src/state'
import type { DeviceState, Peer } from '../src/state'

const peer = (over: Partial<Peer> = {}): Peer => ({
  id: 'marlene0',
  displayName: 'Marlene',
  nonceSelf: 'a',
  noncePeer: 'b',
  connectedAt: 1_000,
  blocked: false,
  ...over,
})

const stateWith = (p: Peer[]): DeviceState => ({
  me: { id: 'nora0000', displayName: 'Nora' },
  threads: [],
  peers: p,
  profile: { displayName: 'Nora', bio: '', neighbourhood: '', languages: [] },
  inventory: [],
  queryLog: [],
})

describe('seeded pairing', () => {
  it('a real ceremony replaces a seeded peer and clears the flag', () => {
    const s = stateWith([peer({ seeded: true })])
    upsertPeer(s, peer({ nonceSelf: 'fresh', noncePeer: 'alsofresh', connectedAt: 9_000, seeded: false }))
    expect(s.peers).toHaveLength(1)
    expect(s.peers[0].seeded).toBe(false)
    expect(s.peers[0].nonceSelf).toBe('fresh')
    expect(s.peers[0].noncePeer).toBe('alsofresh')
  })

  it('replacing a seeded peer takes the REAL timestamp, not the seeded one', () => {
    // Carrying the seed's connectedAt forward would backdate a connection that
    // two people just made to the moment the app happened to be opened.
    const s = stateWith([peer({ seeded: true, connectedAt: 1_000 })])
    upsertPeer(s, peer({ connectedAt: 9_000, seeded: false }))
    expect(s.peers[0].connectedAt).toBe(9_000)
  })

  it('a genuine pairing keeps its original timestamp when re-upserted', () => {
    // The existing "trust history stays honest" rule, unchanged for real peers.
    const s = stateWith([peer({ seeded: false, connectedAt: 1_000 })])
    upsertPeer(s, peer({ connectedAt: 9_000, seeded: false }))
    expect(s.peers[0].connectedAt).toBe(1_000)
  })

  it('a brand new peer is added rather than merged', () => {
    const s = stateWith([])
    upsertPeer(s, peer({ seeded: false }))
    expect(s.peers).toHaveLength(1)
    expect(s.peers[0].id).toBe('marlene0')
  })
})
