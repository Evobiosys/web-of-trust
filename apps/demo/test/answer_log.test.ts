import { describe, expect, it } from 'vitest'
import { logAndDispatch } from '../src/answer_log'
import type { DeviceState } from '../src/state'

/**
 * Deterministic reproduction of the reported bug (DEVLOG: "the local query
 * log is NOT reliably written on the SILENT side"), and the regression test
 * for its fix.
 *
 * The old main.ts's emitAnswer() awaited the transport dispatch (relay.ts's
 * `RelayChannel.send`, which POSTs to the relay's ingress with NO timeout
 * and no AbortController -- see relay.ts's `postToIngress`) BEFORE appending
 * the local Protokoll entry. A silent ambient answer has no UI watching that
 * await, so a send that never settles (flaky wifi, a throttled/backgrounded
 * tab, a slow relay) left the local record unwritten indefinitely -- not
 * merely late, exactly matching the field report ("even after a 9 second
 * wait"). This is reproduced here as a real, deterministic condition (a
 * `dispatch` promise that never resolves) rather than through a flaky
 * browser/network repro, using the ACTUAL function main.ts's emitAnswer()
 * calls (answer_log.ts's logAndDispatch) -- not a reimplementation of it, so
 * a regression here is the regression that matters.
 *
 * Contrast with test/e2e/call_into_the_web.mjs, which asserts on
 * appendQueryLog() called directly against a throwaway state object -- never
 * through emitAnswer()'s actual ordering -- so it stays green regardless of
 * which side of the (now fixed) send the append happens on. That gap is
 * itself part of the finding: a passing e2e run there does not prove I6 held
 * against a real network stall.
 */

function makeDevice(): DeviceState {
  return {
    me: { id: 'ben00000', displayName: 'Ben' },
    threads: [],
    peers: [],
    profile: { displayName: 'Ben', bio: '', neighbourhood: '', languages: [] },
    inventory: [],
    queryLog: [],
  }
}

const entry = {
  at: Date.now(),
  fromDisplayName: 'Nora',
  fromId: 'nora0000',
  text: 'Ski',
  outcome: 'no-match' as const,
}

describe('logAndDispatch (answer_log.ts)', () => {
  it('appends the local log entry even when dispatch() never settles -- the reported bug', () => {
    const s = makeDevice()
    const neverSettles = new Promise<void>(() => {})
    // Deliberately not awaited: the whole point is that the caller (and the
    // test) must not need dispatch() to ever resolve for the log to exist.
    void logAndDispatch(s, entry, () => neverSettles)

    // logAndDispatch is an `async function` with no `await` before its
    // append -- the synchronous prefix (append + fire-and-forget save) runs
    // to completion during the call itself, before dispatch() is even
    // invoked, exactly like any other async function body up to its first
    // await/return. No fake timers or waiting needed: this is true the
    // instant the call above returns.
    expect(s.queryLog).toHaveLength(1)
    expect(s.queryLog[0]).toMatchObject({ fromId: 'nora0000', text: 'Ski', outcome: 'no-match' })
  })

  it('appends the local log entry even when dispatch() rejects', async () => {
    const s = makeDevice()
    await expect(logAndDispatch(s, entry, () => Promise.reject(new Error('relay unreachable'))))
      .rejects.toThrow('relay unreachable')
    // The entry survives the rejection -- it was written before dispatch()
    // ran, not recovered afterwards.
    expect(s.queryLog).toHaveLength(1)
  })

  it('appends the entry BEFORE dispatch() is invoked, not after', () => {
    const s = makeDevice()
    let sawEntryAtDispatchTime = false
    void logAndDispatch(s, entry, async () => {
      sawEntryAtDispatchTime = s.queryLog.length === 1
    })
    expect(sawEntryAtDispatchTime).toBe(true)
  })

  it('propagates dispatch()\'s resolved value unchanged', async () => {
    const s = makeDevice()
    const result = await logAndDispatch(s, entry, async () => 'sent')
    expect(result).toBe('sent')
    expect(s.queryLog).toHaveLength(1)
  })

  it('is a no-op on the log for a null state (defensive, matches emitAnswer\'s own `if (s)` guard)', async () => {
    let dispatched = false
    const result = await logAndDispatch(null, entry, async () => {
      dispatched = true
      return 'ok'
    })
    expect(dispatched).toBe(true)
    expect(result).toBe('ok')
  })
})
