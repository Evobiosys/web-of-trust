import { describe, expect, it, vi } from 'vitest'
import { settleAt, RELAY_DEADLINE_MS } from '../src/gate'

/**
 * Demo 21's uniform deadline (gate.ts's RELAY_DEADLINE_MS doc comment,
 * docs/two-hop-decisions.md §4): A's final answer to B always fires at
 * `receivedAt + RELAY_DEADLINE_MS`, regardless of how quickly or slowly the
 * underlying decision (no note at all, vs. a full round trip to Jakob and
 * back) actually resolved. Proven here with an injected clock
 * (`vi.useFakeTimers`) rather than real wall-clock waits -- see
 * gate_timing.test.ts's own module doc on why a real 30-second wait belongs
 * in a controlled clock, not a live CI run.
 */
describe('demo 21: RELAY_DEADLINE_MS resolves at the same instant regardless of prior work', () => {
  it('a near-instant decision (no note) and a near-full-window decision (Jakob answered just under the deadline) both fire at t0 + RELAY_DEADLINE_MS', async () => {
    vi.useFakeTimers()
    try {
      const t0 = Date.now()

      // Case 1: A had nothing to relay -- resolves in the same tick.
      let fastSettled = false
      const fastPromise = settleAt(t0, RELAY_DEADLINE_MS).then(() => { fastSettled = true })

      // Case 2: A forwarded, Jakob took nearly the whole window to answer --
      // simulated by advancing the clock close to the deadline BEFORE this
      // settleAt call is even made, exactly like forwardToOwner's own
      // `remaining = Math.max(0, receivedAt + RELAY_DEADLINE_MS - Date.now())`.
      await vi.advanceTimersByTimeAsync(RELAY_DEADLINE_MS - 500)
      let slowSettled = false
      const slowPromise = settleAt(t0, RELAY_DEADLINE_MS).then(() => { slowSettled = true })

      // Neither has fired yet -- still short of the shared deadline.
      expect(fastSettled).toBe(false)
      expect(slowSettled).toBe(false)

      await vi.advanceTimersByTimeAsync(500)
      await Promise.all([fastPromise, slowPromise])

      expect(fastSettled).toBe(true)
      expect(slowSettled).toBe(true)
      expect(Date.now()).toBe(t0 + RELAY_DEADLINE_MS)
    } finally {
      vi.useRealTimers()
    }
  })

  it('RELAY_DEADLINE_MS is the project\'s own stated I3 default (CLAUDE.md: "default 30 s, no jitter"), not an invented number', () => {
    expect(RELAY_DEADLINE_MS).toBe(30_000)
  })
})
