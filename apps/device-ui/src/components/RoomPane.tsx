import { useState } from "react";
import type { Room } from "../types";

export interface RoomPaneProps {
  rooms: Room[];
  onSendMessage: (roomId: string, text: string) => void | Promise<void>;
}

/** Shared-room chat, reachable only after INTRO (i.e. once `rooms` is
 * non-empty) — both humans + both agents, identities mutual post-consent. */
export function RoomPane({ rooms, onSendMessage }: RoomPaneProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRoom = rooms.find((r) => r.room_id === selectedId) ?? rooms[0] ?? null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (!text || !activeRoom || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSendMessage(activeRoom.room_id, text);
      setValue("");
    } catch {
      // Keep the drafted message intact on failure — nothing was sent.
      setError("Couldn't reach your agent — try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="pane" data-testid="room-pane" aria-label="Shared room chat">
      <h2 className="pane__title">Shared room chat</h2>

      {rooms.length === 0 ? (
        <p className="empty-state" data-testid="room-pane-empty">
          No rooms yet — a shared room opens once someone says yes.
        </p>
      ) : (
        <>
          {rooms.length > 1 && (
            <ul className="room-list" data-testid="room-list">
              {rooms.map((room) => (
                <li key={room.room_id}>
                  <button
                    type="button"
                    data-testid={`room-tab-${room.room_id}`}
                    aria-current={activeRoom?.room_id === room.room_id}
                    onClick={() => setSelectedId(room.room_id)}
                  >
                    {room.context}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {activeRoom && (
            <>
              <p className="room-context">{activeRoom.context}</p>
              <ul className="room-messages" data-testid="room-messages">
                {activeRoom.messages.map((message, index) => (
                  <li key={`${message.ts}-${index}`} className="room-message">
                    <strong>{message.from}:</strong> {message.text}
                  </li>
                ))}
              </ul>
              <form className="room-composer" onSubmit={handleSubmit}>
                <input
                  data-testid="room-message-input"
                  type="text"
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setError(null);
                  }}
                  placeholder="Message the room…"
                  aria-label="Message the shared room"
                />
                <button data-testid="room-send" type="submit" disabled={sending || !value.trim()}>
                  Send
                </button>
              </form>
              {error && (
                <p className="action-error" data-testid="action-error" role="alert">
                  {error}{" "}
                  <button
                    type="button"
                    className="action-error__dismiss"
                    onClick={() => setError(null)}
                    aria-label="Dismiss error"
                  >
                    ×
                  </button>
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
