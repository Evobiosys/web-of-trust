import { useState } from "react";
import type { ConsentCard } from "../types";

export interface ConsentCardsPaneProps {
  cards: ConsentCard[];
  onConsent: (cardId: string, conditions?: string) => void | Promise<void>;
  onDecline: (cardId: string) => void | Promise<void>;
}

function ConsentCardItem({
  card,
  onConsent,
  onDecline,
}: {
  card: ConsentCard;
  onConsent: (cardId: string, conditions?: string) => void | Promise<void>;
  onDecline: (cardId: string) => void | Promise<void>;
}) {
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inactive = card.state === "inactive";

  const handleYes = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConsent(card.card_id, conditions.trim() || undefined);
    } catch {
      // Keep the typed conditions intact on failure — nothing was sent.
      setError("Couldn't reach your agent — try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleNo = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDecline(card.card_id);
    } catch {
      setError("Couldn't reach your agent — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={`consent-card${inactive ? " consent-card--inactive" : ""}`}
      data-testid={`consent-card-${card.card_id}`}
      aria-disabled={inactive}
    >
      <div className="consent-card__header">
        <strong>{card.requester.display}</strong>
        <span className="consent-card__matched">wants: {card.matched_item.labels.join(", ")}</span>
      </div>
      <p className="consent-card__text">{card.text}</p>

      {card.kind === "relay" && (
        <p className="consent-card__hint" data-testid={`consent-card-relay-hint-${card.card_id}`}>
          This is a friend&apos;s note — forward a friend&apos;s note to answer it.
        </p>
      )}

      {inactive ? (
        <p className="consent-card__status" data-testid={`consent-card-status-${card.card_id}`}>
          request no longer active
        </p>
      ) : card.state === "consented" ? (
        <p className="consent-card__status" data-testid={`consent-card-status-${card.card_id}`}>
          You said yes.
        </p>
      ) : card.state === "declined" ? (
        <p className="consent-card__status" data-testid={`consent-card-status-${card.card_id}`}>
          You declined.
        </p>
      ) : (
        <>
          <input
            data-testid="consent-conditions"
            type="text"
            value={conditions}
            onChange={(event) => {
              setConditions(event.target.value);
              setError(null);
            }}
            placeholder="Any conditions? (e.g. back by Sunday)"
            aria-label={`Conditions for ${card.requester.display}'s request`}
          />
          <div className="consent-card__actions">
            <button data-testid="consent-yes" type="button" onClick={handleYes} disabled={busy}>
              Yes, share
            </button>
            <button data-testid="consent-no" type="button" onClick={handleNo} disabled={busy}>
              No
            </button>
          </div>
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
    </li>
  );
}

export function ConsentCardsPane({ cards, onConsent, onDecline }: ConsentCardsPaneProps) {
  return (
    <section className="pane" data-testid="consent-cards-pane" aria-label="Consent cards">
      <h2 className="pane__title">Consent cards</h2>
      {cards.length === 0 ? (
        <p className="empty-state" data-testid="consent-cards-empty">
          No requests yet.
        </p>
      ) : (
        <ul className="consent-card-list">
          {cards.map((card) => (
            <ConsentCardItem key={card.card_id} card={card} onConsent={onConsent} onDecline={onDecline} />
          ))}
        </ul>
      )}
    </section>
  );
}
