import { useState } from "react";
import type { Ask, StewardLogEntry } from "../types";
import { AskChip } from "./AskChip";

export interface StewardPaneProps {
  log: StewardLogEntry[];
  asks: Ask[];
  onSend: (text: string) => unknown;
}

export function StewardPane({ log, asks, onSend }: StewardPaneProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setValue("");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="pane" data-testid="steward-pane" aria-label="Steward chat">
      <h2 className="pane__title">Steward chat</h2>

      {asks.length > 0 && (
        <div className="ask-chips" data-testid="ask-chips">
          {asks.map((ask) => (
            <AskChip key={ask.request_id} ask={ask} />
          ))}
        </div>
      )}

      <div className="steward-log" data-testid="steward-log">
        {log.length === 0 ? (
          <p className="empty-state" data-testid="steward-log-empty">
            No messages yet — say hello to your steward.
          </p>
        ) : (
          <ul className="steward-log__list">
            {log.map((entry, index) => (
              <li key={`${entry.ts}-${index}`} className={`steward-log__entry steward-log__entry--${entry.role}`}>
                <span className="steward-log__role">{entry.role === "user" ? "You" : "Steward"}</span>
                <span className="steward-log__text">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="steward-composer" onSubmit={handleSubmit}>
        <input
          data-testid="steward-input"
          className="steward-composer__input"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Ask your steward anything…"
          aria-label="Message to your steward"
        />
        <button
          data-testid="steward-send"
          className="steward-composer__send"
          type="submit"
          disabled={sending || !value.trim()}
        >
          Send
        </button>
      </form>
    </section>
  );
}
