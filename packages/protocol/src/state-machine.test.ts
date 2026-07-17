import { describe, it, expect } from "vitest";
import {
  transitionAskerState,
  transitionOwnerState,
  type AskerRequestState,
  type OwnerRequestState,
} from "./state-machine.js";

describe("asker-side request lifecycle", () => {
  it("open -> pending when some peers are still pending", () => {
    expect(transitionAskerState("open", { type: "STATUS_ALL_IN", anyPending: true })).toBe("pending");
  });

  it("open -> pass when all responses are PASS (no match anywhere)", () => {
    expect(transitionAskerState("open", { type: "STATUS_ALL_IN", anyPending: false })).toBe("pass");
  });

  it("pending -> consented on owner CONSENT", () => {
    expect(transitionAskerState("pending", { type: "CONSENT" })).toBe("consented");
  });

  it("consented -> room on ROOM_CREATED", () => {
    expect(transitionAskerState("consented", { type: "ROOM_CREATED" })).toBe("room");
  });

  it("room -> closed on CLOSE", () => {
    expect(transitionAskerState("room", { type: "CLOSE" })).toBe("closed");
  });

  it.each<AskerRequestState>(["open", "pending", "consented", "room"])(
    "%s -> withdrawn on WITHDRAW (any active state)",
    (state) => {
      expect(transitionAskerState(state, { type: "WITHDRAW", reason: "cancelled" })).toBe("withdrawn");
    }
  );

  it("TTL expiry models as WITHDRAW with reason 'expired' from any active state", () => {
    expect(transitionAskerState("pending", { type: "WITHDRAW", reason: "expired" })).toBe("withdrawn");
    expect(transitionAskerState("open", { type: "WITHDRAW", reason: "expired" })).toBe("withdrawn");
  });

  it("rejects CONSENT from 'open' (STATUS round must complete first)", () => {
    expect(() => transitionAskerState("open", { type: "CONSENT" })).toThrow();
  });

  it("rejects ROOM_CREATED from 'pending'", () => {
    expect(() => transitionAskerState("pending", { type: "ROOM_CREATED" })).toThrow();
  });

  it("rejects STATUS_ALL_IN from a non-'open' state", () => {
    expect(() => transitionAskerState("pass", { type: "STATUS_ALL_IN", anyPending: false })).toThrow();
  });

  it.each<AskerRequestState>(["pass", "closed", "withdrawn"])("rejects WITHDRAW from terminal state %s", (state) => {
    expect(() => transitionAskerState(state, { type: "WITHDRAW", reason: "cancelled" })).toThrow();
  });

  it("rejects CLOSE from 'consented' (room must be created first)", () => {
    expect(() => transitionAskerState("consented", { type: "CLOSE" })).toThrow();
  });
});

describe("owner-side incoming-request lifecycle", () => {
  it("received -> matched on MATCH_RESULT(matched=true)", () => {
    expect(transitionOwnerState("received", { type: "MATCH_RESULT", matched: true })).toBe("matched");
  });

  it("received -> no_match on MATCH_RESULT(matched=false)", () => {
    expect(transitionOwnerState("received", { type: "MATCH_RESULT", matched: false })).toBe("no_match");
  });

  it("matched -> consented on CONSENT_DECISION(accepted=true)", () => {
    expect(transitionOwnerState("matched", { type: "CONSENT_DECISION", accepted: true })).toBe("consented");
  });

  it("matched -> passed on CONSENT_DECISION(accepted=false)", () => {
    expect(transitionOwnerState("matched", { type: "CONSENT_DECISION", accepted: false })).toBe("passed");
  });

  it.each<OwnerRequestState>(["consented", "passed", "no_match"])("%s -> closed on CLOSE", (state) => {
    expect(transitionOwnerState(state, { type: "CLOSE" })).toBe("closed");
  });

  it.each<OwnerRequestState>(["received", "matched", "no_match", "consented", "passed"])(
    "%s -> withdrawn on WITHDRAW (any active state)",
    (state) => {
      expect(transitionOwnerState(state, { type: "WITHDRAW", reason: "cancelled" })).toBe("withdrawn");
    }
  );

  it("TTL expiry models as WITHDRAW with reason 'expired' from any active state", () => {
    expect(transitionOwnerState("matched", { type: "WITHDRAW", reason: "expired" })).toBe("withdrawn");
  });

  it("rejects CONSENT_DECISION from 'received' (must match first)", () => {
    expect(() => transitionOwnerState("received", { type: "CONSENT_DECISION", accepted: true })).toThrow();
  });

  it("rejects MATCH_RESULT from 'matched'", () => {
    expect(() => transitionOwnerState("matched", { type: "MATCH_RESULT", matched: true })).toThrow();
  });

  it.each<OwnerRequestState>(["closed", "withdrawn"])("rejects WITHDRAW from terminal state %s", (state) => {
    expect(() => transitionOwnerState(state, { type: "WITHDRAW", reason: "cancelled" })).toThrow();
  });

  it("rejects CLOSE from 'received' (nothing to close yet)", () => {
    expect(() => transitionOwnerState("received", { type: "CLOSE" })).toThrow();
  });
});
