import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { AgentState } from "./types";

class MockWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(_url: string) {}
  close() {}
}

function sampleState(): AgentState {
  return {
    persona: { name: "Anna", peer_id: "@anna-agent:wot.local", accent: "warm" },
    items: [],
    trust_edges: [],
    asks: [],
    consent_cards: [],
    rooms: [],
    steward_log: [],
  };
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a loading state before the first /api/state resolves, then renders the four panes", async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    expect(screen.getByTestId("app-loading")).toBeInTheDocument();

    resolveFetch({ ok: true, json: async () => sampleState() });

    await waitFor(() => expect(screen.queryByTestId("app-loading")).not.toBeInTheDocument());
    expect(screen.getByTestId("steward-pane")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-pane")).toBeInTheDocument();
    expect(screen.getByTestId("consent-cards-pane")).toBeInTheDocument();
    expect(screen.getByTestId("room-pane")).toBeInTheDocument();
  });

  it("renders all-empty states together for a fresh persona with no data yet", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleState() });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("steward-log-empty")).toBeInTheDocument());
    expect(screen.getByTestId("inventory-empty")).toBeInTheDocument();
    expect(screen.getByTestId("consent-cards-empty")).toBeInTheDocument();
    expect(screen.getByTestId("room-pane-empty")).toBeInTheDocument();
  });
});
