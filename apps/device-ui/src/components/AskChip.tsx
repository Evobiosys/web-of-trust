import type { Ask } from "../types";

/**
 * Asker-facing status chip for one outbound request. I2 (asker blindness):
 * this component may render ONLY fields on the `Ask` type — text, state,
 * the aggregate `queried_count`, created_at — never a peer id, per-peer
 * status, or any "N pending / M passed" breakdown (explicitly forbidden by
 * the brief). Do not widen this component's props beyond `Ask`.
 */
export function AskChip({ ask }: { ask: Ask }) {
  const testId = `ask-chip-${ask.request_id}`;

  if (ask.state === "withdrawn") {
    return (
      <div data-testid={testId} className="ask-chip ask-chip--withdrawn">
        <span className="ask-chip__text ask-chip__text--struck">{ask.text}</span>
        <span className="ask-chip__label">Withdrawn</span>
      </div>
    );
  }

  const label = (() => {
    switch (ask.state) {
      case "waiting":
        return `Asked ${ask.queried_count} trusted people nearby. You'll hear back.`;
      case "someone_can_help":
      case "room_open":
        return "Good news — someone has one and said yes.";
      case "no_one_this_time":
        return "No one could help this time.";
      case "open":
      default:
        return "Asking around…";
    }
  })();

  return (
    <div data-testid={testId} className={`ask-chip ask-chip--${ask.state}`}>
      <span className="ask-chip__text">{ask.text}</span>
      <span className="ask-chip__label">{label}</span>
    </div>
  );
}
