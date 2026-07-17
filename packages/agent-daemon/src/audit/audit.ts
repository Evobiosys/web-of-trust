// I6 — every agent decision logged locally, human-readable. This is the only
// place `Store.addAudit` is called from, so the asker/owner-redaction
// discipline (I2) lives in one spot: `logAsker` structurally cannot accept a
// peer id or per-peer STATUS word in its detail text (see the runtime guard
// below), so misuse fails loudly in dev/tests rather than silently leaking.
import type { Clock } from "../clock.js";
import type { Store } from "../store/store.js";

const FORBIDDEN_IN_ASKER_DETAIL = [/PENDING/i];

export function logOwner(store: Store, clock: Clock, requestId: string, action: string, detail: string, reason?: string): void {
  store.addAudit({ ts: clock.now().toISOString(), request_id: requestId, actor: "owner", action, detail, reason, redact_for_asker: false });
}

/**
 * Asker-side audit entries must never reveal which peer sent what, nor
 * whether a given peer's reply was PENDING vs PASS (I2, rung-0 residual
 * redaction). Callers should already only ever pass aggregate-level facts;
 * this guard throws in dev/test if that discipline slips, rather than
 * silently persisting a leaky entry.
 */
export function logAsker(store: Store, clock: Clock, requestId: string, action: string, detail: string, peerIdsInScope: string[]): void {
  for (const peerId of peerIdsInScope) {
    if (detail.includes(peerId)) {
      throw new Error(`logAsker: detail leaks peer id '${peerId}' — I2 violation. detail="${detail}"`);
    }
  }
  for (const pattern of FORBIDDEN_IN_ASKER_DETAIL) {
    if (pattern.test(detail)) {
      throw new Error(`logAsker: detail leaks a per-peer STATUS word — I2 violation. detail="${detail}"`);
    }
  }
  store.addAudit({ ts: clock.now().toISOString(), request_id: requestId, actor: "asker", action, detail, redact_for_asker: true });
}
