import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AskChip } from "./components/AskChip";
import { StewardPane } from "./components/StewardPane";
import type { Ask } from "./types";

/**
 * I2 (asker blindness): asker-facing surfaces must render only the
 * aggregate — never per-peer identity, per-peer response state, or a
 * "N pending / M passed" breakdown (explicitly forbidden by the brief).
 *
 * The real `Ask` type (docs/API.md) is already sanitized, so a test that
 * only feeds a clean `Ask` proves nothing about the UI's own discipline.
 * Instead we craft a state with injected internals — as if a buggy/relayed
 * payload carried per-peer detail — and assert none of it reaches the DOM.
 */

const LEAKY_PEER_ID = "@ben-agent:wot.local";
const LEAKY_DISPLAY = "Ben";
const OTHER_LEAKY_DISPLAY = "Timo";

// Deliberately widen beyond the `Ask` type to simulate a corrupted/leaky
// payload — this is the "crafted state with internals" the brief calls for.
const craftedAsk = {
  request_id: "req-leak-1",
  text: "Hat wer einen Akkuschrauber?",
  created_at: "2026-01-01T00:00:00.000Z",
  state: "waiting",
  queried_count: 2,
  // --- injected internals that must NEVER render on the asker side ---
  queried_peers: [
    { peer_id: LEAKY_PEER_ID, display: LEAKY_DISPLAY, response: "PASS" },
    { peer_id: "@timo-agent:wot.local", display: OTHER_LEAKY_DISPLAY, response: "PENDING" },
  ],
  per_peer_state: { [LEAKY_PEER_ID]: "no_match", "@timo-agent:wot.local": "considering" },
  owner_peer_id: LEAKY_PEER_ID,
} as unknown as Ask;

describe("I2 asker blindness — AskChip", () => {
  it("renders only the aggregate, never peer ids/displays/per-peer state from a crafted payload", () => {
    const { container } = render(<AskChip ask={craftedAsk} />);
    const html = container.innerHTML;

    expect(html).not.toContain(LEAKY_PEER_ID);
    expect(html).not.toContain(LEAKY_DISPLAY);
    expect(html).not.toContain(OTHER_LEAKY_DISPLAY);
    expect(html).not.toContain("PASS");
    expect(html).not.toContain("PENDING");
    expect(html).not.toContain("no_match");
    expect(html).not.toContain("considering");

    // The forbidden "N pending / M passed"-style breakdown must not appear,
    // even though queried_count (the aggregate) is legitimate to show.
    expect(html).not.toMatch(/\d+\s*pending/i);
    expect(html).not.toMatch(/\d+\s*passed/i);

    // The legitimate aggregate is still present.
    expect(screen.getByTestId("ask-chip-req-leak-1")).toHaveTextContent(
      "Asked 2 trusted people nearby. You'll hear back.",
    );
  });
});

describe("I2 asker blindness — StewardPane", () => {
  it("renders ask chips from a crafted asks[] with no peer leakage anywhere in the pane", () => {
    const { container } = render(<StewardPane log={[]} asks={[craftedAsk]} onSend={vi.fn()} />);
    const html = container.innerHTML;

    expect(html).not.toContain(LEAKY_PEER_ID);
    expect(html).not.toContain(LEAKY_DISPLAY);
    expect(html).not.toContain(OTHER_LEAKY_DISPLAY);
    expect(html).not.toContain("PASS");
    expect(html).not.toContain("PENDING");
  });
});
