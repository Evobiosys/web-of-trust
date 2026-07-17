// Request lifecycle state machine — HANDOVER §6.1/§7.
//
// Two independent machines, one per side of a request:
//   - asker request:        open -> (all STATUS in) pass | pending -> consented -> room -> closed
//                            any active state -> withdrawn
//   - owner incoming request: received -> matched/no_match -> (consent pending) -> consented/passed -> closed/withdrawn
//
// Pure functions; invalid transitions throw. No I/O, no timers — callers
// (agent-daemon) decide *when* to fire events; this module only decides
// whether a given (state, event) pair is legal and what state results.
//
// Design notes / interpretation calls (documented rather than silently assumed):
// - TTL expiry is modeled as `WITHDRAW` with `reason: "expired"`, not as a
//   separate state or event type. It is valid from every non-terminal state,
//   same as any other withdrawal — this satisfies "include a TTL expiry
//   transition" while keeping one event shape per side, and maps 1:1 onto
//   WITHDRAWN.reason in the envelope (envelope.ts).
// - Owner-side "no_match" is treated as a valid predecessor of `closed` /
//   `withdrawn`, alongside `consented`/`passed`: the brief's chain
//   ("received -> matched/no_match -> (consent pending) -> consented/passed ->
//   closed/withdrawn") reads ambiguously about whether no_match feeds forward
//   too, but every request record — matched or not — needs a way to be closed
//   out or withdrawn, so no_match is wired the same as passed.

export type WithdrawnReason = "fulfilled" | "expired" | "cancelled";

export type AskerRequestState = "open" | "pass" | "pending" | "consented" | "room" | "closed" | "withdrawn";

export type AskerEvent =
  | { type: "STATUS_ALL_IN"; anyPending: boolean }
  | { type: "CONSENT" }
  | { type: "ROOM_CREATED" }
  | { type: "CLOSE" }
  | { type: "WITHDRAW"; reason: WithdrawnReason };

const ASKER_ACTIVE_STATES: readonly AskerRequestState[] = ["open", "pending", "consented", "room"];

export type OwnerRequestState =
  | "received"
  | "matched"
  | "no_match"
  | "consented"
  | "passed"
  | "closed"
  | "withdrawn";

export type OwnerEvent =
  | { type: "MATCH_RESULT"; matched: boolean }
  | { type: "CONSENT_DECISION"; accepted: boolean }
  | { type: "CLOSE" }
  | { type: "WITHDRAW"; reason: WithdrawnReason };

const OWNER_ACTIVE_STATES: readonly OwnerRequestState[] = ["received", "matched", "no_match", "consented", "passed"];
const OWNER_CLOSABLE_STATES: readonly OwnerRequestState[] = ["consented", "passed", "no_match"];

function invalidTransition(state: string, event: { type: string }): Error {
  return new Error(`Invalid transition: event '${event.type}' is not valid from state '${state}'`);
}

export function transitionAskerState(state: AskerRequestState, event: AskerEvent): AskerRequestState {
  switch (event.type) {
    case "STATUS_ALL_IN": {
      if (state !== "open") throw invalidTransition(state, event);
      return event.anyPending ? "pending" : "pass";
    }
    case "CONSENT": {
      if (state !== "pending") throw invalidTransition(state, event);
      return "consented";
    }
    case "ROOM_CREATED": {
      if (state !== "consented") throw invalidTransition(state, event);
      return "room";
    }
    case "CLOSE": {
      if (state !== "room") throw invalidTransition(state, event);
      return "closed";
    }
    case "WITHDRAW": {
      if (!ASKER_ACTIVE_STATES.includes(state)) throw invalidTransition(state, event);
      return "withdrawn";
    }
  }
}

export function transitionOwnerState(state: OwnerRequestState, event: OwnerEvent): OwnerRequestState {
  switch (event.type) {
    case "MATCH_RESULT": {
      if (state !== "received") throw invalidTransition(state, event);
      return event.matched ? "matched" : "no_match";
    }
    case "CONSENT_DECISION": {
      if (state !== "matched") throw invalidTransition(state, event);
      return event.accepted ? "consented" : "passed";
    }
    case "CLOSE": {
      if (!OWNER_CLOSABLE_STATES.includes(state)) throw invalidTransition(state, event);
      return "closed";
    }
    case "WITHDRAW": {
      if (!OWNER_ACTIVE_STATES.includes(state)) throw invalidTransition(state, event);
      return "withdrawn";
    }
  }
}
