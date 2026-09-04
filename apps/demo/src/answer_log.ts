/**
 * I6 Auditability's ordering guarantee for an answered query, extracted from
 * main.ts's emitAnswer() so it is something a test can call directly rather
 * than a proxy for it (same reasoning as incoming_query.ts's module doc
 * comment: the app must call the SAME function the test asserts on).
 *
 * THE BUG THIS EXISTS TO CLOSE: relay.ts's ingress POST
 * (postToIngress, called by RelayChannel.send) has NO timeout and no
 * AbortController -- a stalled `fetch` (flaky wifi, a backgrounded/throttled
 * tab, a slow relay) simply never settles. main.ts's emitAnswer() used to
 * `await sendAnswerOverRelay/Webrtc(...)` BEFORE appending the local
 * Protokoll entry ("logging happens LAST ... after the wire message has
 * already gone out"). On the SILENT ambient path nothing else is waiting on
 * that promise and nothing renders while it hangs, so a stalled send left
 * the device with no visible symptom and no local record either -- exactly
 * the reproduced bug: a device asked a question, correctly showed nothing,
 * and the one thing that was supposed to make that silence auditable never
 * got written, for as long as the network stayed stuck (observed: still
 * missing after a 9s wait, i.e. indefinitely, not merely delayed).
 *
 * THE FIX: the local record must never be hostage to the network. Append the
 * entry, and kick off (but do not await) its IndexedDB persist, BEFORE
 * `dispatch` (the network send, or a QR-code render, or whatever else the
 * caller does with the already-decided outcome) is even invoked -- not
 * after it resolves. This is safe for the timing side channel `dispatch`
 * itself must still not open (I3): `appendQueryLog` is a plain array push,
 * O(1) and identical cost regardless of `outcome` or how many `match.hits`
 * fired (see QueryLogEntry's own doc comment -- match content is never
 * stored, only the label), so doing it here changes nothing about WHEN
 * `dispatch`'s bytes leave this device. Only the local record's existence
 * stops depending on `dispatch` ever completing.
 *
 * `dispatch`'s own outcome (resolution or rejection) is returned/propagated
 * unchanged -- this wrapper does not swallow it. Every current caller
 * (sendAnswerOverRelay/sendAnswerOverWebrtc, and the QR fallback) already
 * catches its own transport failures internally; this is not a second
 * catch, only a reordering.
 */
import { appendQueryLog, saveState } from './state'
import type { DeviceState } from './state'
import type { QueryLogEntry } from './types'

export async function logAndDispatch<T>(
  s: DeviceState | null,
  entry: Omit<QueryLogEntry, 'id'>,
  dispatch: () => Promise<T>,
): Promise<T> {
  // INVARIANT: nothing above this line may `await` anything. This function's
  // whole reason to exist is that the append below runs synchronously, in
  // the same microtask as the call, before `dispatch` is even invoked --
  // that is what makes the entry's existence independent of whether
  // `dispatch` ever settles (see this module's doc comment and
  // test/answer_log.test.ts's "BEFORE dispatch() is invoked" case, which
  // pins exactly this). An `await` inserted here, even one that resolves
  // instantly, would reopen the bug this file fixes.
  if (s) {
    appendQueryLog(s, entry)
    // Un-awaited on purpose: the (comparatively slow, IndexedDB-backed)
    // persist must not delay `dispatch` below either -- see this module's
    // doc comment. A failed persist is not fatal (state.ts's saveState/
    // db.ts's kvSet already swallow storage errors internally).
    void saveState(s)
  }
  return dispatch()
}
