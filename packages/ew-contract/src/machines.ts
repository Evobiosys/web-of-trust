/**
 * Explicit state machines for the two flows the backend must interoperate with
 * precisely: the meet ceremony {CER-1..5} and the loan loop {RES-4/5}.
 * Pure transition functions — no timers, no IO. The app schedules effects.
 */
import { Level, LoanState } from "./types.js";

/* ---------------- Ceremony {CER-*} ---------------- */

export type CeremonyStep = "compose" | "scanning" | "confirm" | "weaving" | "celebrate";

/** The identity of the person found by a scan — from THEIR HandshakePayload, never invented. */
export interface CeremonyPeer {
  did: string;
  displayName: string;
}

export interface CeremonyState {
  step: CeremonyStep;
  offeredLevel: Level;
  channel: "qr" | "nfc";
  /** level actually confirmed for the found peer (preselected to offeredLevel) */
  confirmedLevel: Level | null;
  peer: CeremonyPeer | null;
}

export type CeremonyEvent =
  | { type: "SET_LEVEL"; level: Level }
  | { type: "SET_CHANNEL"; channel: "qr" | "nfc" }
  | { type: "SCAN" }
  | { type: "CANCEL" }
  | { type: "PEER_FOUND"; peer: CeremonyPeer }
  | { type: "PICK_LEVEL"; level: Level }
  | { type: "CONFIRM" }
  | { type: "MUTUAL_CONFIRMED" }
  | { type: "RESET" };

export const initialCeremony: CeremonyState = {
  step: "compose",
  offeredLevel: "contact",
  channel: "qr",
  confirmedLevel: null,
  peer: null,
};

export function ceremonyReducer(s: CeremonyState, e: CeremonyEvent): CeremonyState {
  switch (e.type) {
    case "SET_LEVEL":
      return s.step === "compose" ? { ...s, offeredLevel: e.level } : s;
    case "SET_CHANNEL":
      return s.step === "compose" ? { ...s, channel: e.channel } : s;
    case "SCAN":
      return s.step === "compose" ? { ...s, step: "scanning" } : s;
    case "CANCEL":
      return s.step === "scanning" || s.step === "confirm"
        ? { ...s, step: "compose", peer: null, confirmedLevel: null }
        : s;
    case "PEER_FOUND":
      return s.step === "scanning"
        ? { ...s, step: "confirm", peer: e.peer, confirmedLevel: s.offeredLevel }
        : s;
    case "PICK_LEVEL":
      return s.step === "confirm" ? { ...s, confirmedLevel: e.level } : s;
    case "CONFIRM":
      return s.step === "confirm" && s.confirmedLevel ? { ...s, step: "weaving" } : s;
    case "MUTUAL_CONFIRMED":
      // celebration fires ONLY on mutual {CER-5}
      return s.step === "weaving" ? { ...s, step: "celebrate" } : s;
    case "RESET":
      return { ...initialCeremony, offeredLevel: s.offeredLevel, channel: s.channel };
    default:
      return s;
  }
}

/* ---------------- Loan loop {RES-4} ---------------- */

export type LoanEvent = "REQUEST" | "ACCEPT" | "DECLINE" | "RETURN" | "BOTH_CHECKED_IN";

/** available → requested → lent → returned → complete; decline returns to available. */
const LOAN_TRANSITIONS: Record<LoanState, Partial<Record<LoanEvent, LoanState>>> = {
  available: { REQUEST: "requested" },
  requested: { ACCEPT: "lent", DECLINE: "available" },
  lent: { RETURN: "returned" },
  returned: { BOTH_CHECKED_IN: "complete" },
  complete: {},
};

export function loanTransition(state: LoanState, event: LoanEvent): LoanState {
  const next = LOAN_TRANSITIONS[state][event];
  if (!next) {
    throw new Error(`loan: illegal transition ${state} --${event}-->`);
  }
  return next;
}

export function canLoan(state: LoanState, event: LoanEvent): boolean {
  return Boolean(LOAN_TRANSITIONS[state][event]);
}

/** Non-throwing variant for real-world callers (double-taps, stale snapshots, relay races):
 *  a rejected transition is DATA, not an exception. */
export type LoanResult = { ok: true; state: LoanState } | { ok: false; error: string };
export function tryLoanTransition(state: LoanState, event: LoanEvent): LoanResult {
  const next = LOAN_TRANSITIONS[state][event];
  return next ? { ok: true, state: next } : { ok: false, error: `illegal ${state} --${event}` };
}
