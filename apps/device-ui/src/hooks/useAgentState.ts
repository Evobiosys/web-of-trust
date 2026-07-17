import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState } from "../types";

const POLL_INTERVAL_MS = 5000;

export type ConnectionMode = "connecting" | "ws" | "poll";

export interface UseAgentStateResult {
  state: AgentState | null;
  loading: boolean;
  error: string | null;
  connection: ConnectionMode;
  /** POST /api/steward — returns the agent's reply text. */
  sendSteward: (text: string) => Promise<string>;
  sendConsent: (cardId: string, conditions?: string) => Promise<void>;
  sendDecline: (cardId: string) => Promise<void>;
  sendRoomMessage: (roomId: string, text: string) => Promise<void>;
}

function toWsUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(payload.error ?? `request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch + WS hook for a single agent's REST/WS API (docs/API.md). On any WS
 * event the client refetches /api/state — `state_changed` is the only event
 * strictly needed, the rest are treated as hints (per API.md). Falls back to
 * polling every 5s if the WS connection is unavailable or drops.
 */
export function useAgentState(baseUrl: string): UseAgentStateResult {
  const [state, setState] = useState<AgentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionMode>("connecting");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/state`);
      if (!res.ok) throw new Error(`GET /api/state failed: ${res.status}`);
      const next = (await res.json()) as AgentState;
      if (!mountedRef.current) return;
      setState(next);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "failed to load state");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [baseUrl]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      void refetch();
    }, POLL_INTERVAL_MS);
  }, [refetch]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refetch();

    let socket: WebSocket | undefined;
    try {
      socket = new WebSocket(toWsUrl(baseUrl));
      socketRef.current = socket;

      socket.onopen = () => {
        if (!mountedRef.current) return;
        setConnection("ws");
        stopPolling();
      };
      socket.onmessage = () => {
        // Any event (state_changed, steward_reply, ask_update, room_message,
        // consent_card) triggers a refetch; state_changed is the one the UI
        // strictly needs, the rest are treated as hints only.
        void refetch();
      };
      socket.onerror = () => {
        if (!mountedRef.current) return;
        setConnection("poll");
        startPolling();
      };
      socket.onclose = () => {
        if (!mountedRef.current) return;
        setConnection("poll");
        startPolling();
      };
    } catch {
      setConnection("poll");
      startPolling();
    }

    return () => {
      mountedRef.current = false;
      stopPolling();
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  const sendSteward = useCallback(
    async (text: string) => {
      const { reply } = await postJson<{ reply: string }>(`${baseUrl}/api/steward`, { text });
      await refetch();
      return reply;
    },
    [baseUrl, refetch],
  );

  const sendConsent = useCallback(
    async (cardId: string, conditions?: string) => {
      await postJson(`${baseUrl}/api/consent`, conditions ? { card_id: cardId, conditions } : { card_id: cardId });
      await refetch();
    },
    [baseUrl, refetch],
  );

  const sendDecline = useCallback(
    async (cardId: string) => {
      await postJson(`${baseUrl}/api/decline`, { card_id: cardId });
      await refetch();
    },
    [baseUrl, refetch],
  );

  const sendRoomMessage = useCallback(
    async (roomId: string, text: string) => {
      await postJson(`${baseUrl}/api/rooms/${encodeURIComponent(roomId)}/message`, { text });
      await refetch();
    },
    [baseUrl, refetch],
  );

  return { state, loading, error, connection, sendSteward, sendConsent, sendDecline, sendRoomMessage };
}
