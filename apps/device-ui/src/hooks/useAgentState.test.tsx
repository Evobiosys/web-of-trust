import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentState } from "./useAgentState";
import type { AgentState } from "../types";

const BASE_URL = "http://localhost:4101";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

function sampleState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    persona: { name: "Anna", peer_id: "@anna-agent:wot.local", accent: "warm" },
    items: [],
    trust_edges: [],
    asks: [],
    consent_cards: [],
    rooms: [],
    steward_log: [],
    ...overrides,
  };
}

describe("useAgentState", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("fetches /api/state on mount and exposes it once loaded", async () => {
    const state = sampleState();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => state });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgentState(BASE_URL));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state).toEqual(state);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/state`);
  });

  it("opens a WS connection at /ws derived from the base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleState() });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useAgentState(BASE_URL));

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(MockWebSocket.instances[0].url).toBe("ws://localhost:4101/ws");
  });

  it("refetches state on any WS message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleState() });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useAgentState(BASE_URL));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const callsBefore = fetchMock.mock.calls.length;

    act(() => {
      MockWebSocket.instances[0].onmessage?.();
    });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("falls back to polling every 5s when the WS connection errors", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sampleState() });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgentState(BASE_URL));

    await act(async () => {
      await Promise.resolve();
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => {
      MockWebSocket.instances[0].onerror?.();
    });
    expect(result.current.connection).toBe("poll");

    const callsBeforePoll = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforePoll);
  });

  it("sendSteward posts to /api/steward, returns the reply, and refetches state", async () => {
    const initial = sampleState();
    const updated = sampleState({ steward_log: [{ role: "agent", text: "hi back", ts: "2026-01-01T00:00:00.000Z" }] });
    let getCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ reply: "hi back" }) });
      }
      getCount += 1;
      return Promise.resolve({ ok: true, json: async () => (getCount === 1 ? initial : updated) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAgentState(BASE_URL));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let reply = "";
    await act(async () => {
      reply = await result.current.sendSteward("hi");
    });

    expect(reply).toBe("hi back");
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/steward`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "hi" }) }),
    );
    await waitFor(() => expect(result.current.state).toEqual(updated));
  });
});
