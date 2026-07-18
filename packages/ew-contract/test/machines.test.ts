import { describe, expect, it } from "vitest";
import {
  canLoan,
  ceremonyReducer,
  initialCeremony,
  loanTransition,
  tryLoanTransition,
} from "../src/index.js";

const MARIA = { did: "did:key:demo-maria", displayName: "Maria" };

describe("ceremony machine", () => {
  it("walks the happy path and celebrates only on mutual", () => {
    let s = initialCeremony;
    s = ceremonyReducer(s, { type: "SET_LEVEL", level: "friend" });
    s = ceremonyReducer(s, { type: "SCAN" });
    expect(s.step).toBe("scanning");
    s = ceremonyReducer(s, { type: "PEER_FOUND", peer: MARIA });
    expect(s.step).toBe("confirm");
    expect(s.peer?.displayName).toBe("Maria");
    expect(s.confirmedLevel).toBe("friend"); // preselected to the offered level {CER-4}
    s = ceremonyReducer(s, { type: "CONFIRM" });
    expect(s.step).toBe("weaving");
    // no celebration without the counter-attestation
    expect(ceremonyReducer(s, { type: "PEER_FOUND", peer: MARIA }).step).toBe("weaving");
    s = ceremonyReducer(s, { type: "MUTUAL_CONFIRMED" });
    expect(s.step).toBe("celebrate");
  });

  it("cancel returns to compose from scanning and confirm", () => {
    let s = ceremonyReducer(initialCeremony, { type: "SCAN" });
    expect(ceremonyReducer(s, { type: "CANCEL" }).step).toBe("compose");
    s = ceremonyReducer(s, { type: "PEER_FOUND", peer: MARIA });
    expect(ceremonyReducer(s, { type: "CANCEL" }).peer).toBeNull();
  });

  it("cannot confirm without a picked level", () => {
    let s = ceremonyReducer(initialCeremony, { type: "SCAN" });
    s = ceremonyReducer(s, { type: "PEER_FOUND", peer: MARIA });
    s = { ...s, confirmedLevel: null };
    expect(ceremonyReducer(s, { type: "CONFIRM" }).step).toBe("confirm");
  });
});

describe("loan machine", () => {
  it("walks available → requested → lent → returned → complete", () => {
    let s = loanTransition("available", "REQUEST");
    s = loanTransition(s, "ACCEPT");
    s = loanTransition(s, "RETURN");
    s = loanTransition(s, "BOTH_CHECKED_IN");
    expect(s).toBe("complete");
  });
  it("decline returns to available", () => {
    expect(loanTransition("requested", "DECLINE")).toBe("available");
  });
  it("rejects illegal transitions", () => {
    expect(() => loanTransition("available", "RETURN")).toThrow();
    expect(canLoan("complete", "REQUEST")).toBe(false);
  });
  it("tryLoanTransition returns rejection as data, never throws", () => {
    expect(tryLoanTransition("available", "RETURN")).toEqual({ ok: false, error: "illegal available --RETURN" });
    expect(tryLoanTransition("available", "REQUEST")).toEqual({ ok: true, state: "requested" });
  });
});
