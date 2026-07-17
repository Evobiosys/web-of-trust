import { describe, it, expect } from "vitest";
import { buildEnvelopeContent, extractEnvelopeWire, ENVELOPE_MSGTYPE, ENVELOPE_CONTENT_KEY } from "./wire.js";

describe("wire format", () => {
  it("builds content with matching msgtype and content key, human-readable body", () => {
    const content = buildEnvelopeContent("REQUEST", '{"v":"0.1"}');
    expect(content.msgtype).toBe(ENVELOPE_MSGTYPE);
    expect(content.body).toBe("resource-web envelope: REQUEST");
    expect(content[ENVELOPE_CONTENT_KEY]).toBe('{"v":"0.1"}');
  });

  it("extracts the wire string from a matching m.room.message content", () => {
    const content = buildEnvelopeContent("STATUS", '{"v":"0.1","type":"STATUS"}');
    expect(extractEnvelopeWire(content)).toBe('{"v":"0.1","type":"STATUS"}');
  });

  it("returns undefined for a foreign msgtype (e.g. plain m.text)", () => {
    expect(extractEnvelopeWire({ msgtype: "m.text", body: "hello" })).toBeUndefined();
  });

  it("returns undefined for non-object content", () => {
    expect(extractEnvelopeWire(null)).toBeUndefined();
    expect(extractEnvelopeWire(undefined)).toBeUndefined();
    expect(extractEnvelopeWire("string")).toBeUndefined();
  });

  it("returns undefined when the matching msgtype is present but content key is missing/non-string", () => {
    expect(extractEnvelopeWire({ msgtype: ENVELOPE_MSGTYPE, body: "x" })).toBeUndefined();
    expect(extractEnvelopeWire({ msgtype: ENVELOPE_MSGTYPE, body: "x", [ENVELOPE_CONTENT_KEY]: 42 })).toBeUndefined();
  });
});
