import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConsentCardsPane } from "./ConsentCardsPane";
import type { ConsentCard, Item } from "../types";

const matchedItem: Item = {
  id: "item-screwdriver",
  labels: ["Bosch IXO cordless screwdriver"],
  description: "barely used",
  tags: [],
  provenance: { kind: "self" },
  policy: { audience: "trusted", mode: "ask_each_time" },
};

function makeCard(overrides: Partial<ConsentCard> = {}): ConsentCard {
  return {
    card_id: "card-1",
    request_id: "req-1",
    requester: { peer_id: "@anna-agent:wot.local", display: "Anna" },
    text: "Hat wer einen Akkuschrauber?",
    matched_item: matchedItem,
    kind: "direct",
    state: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ConsentCardsPane", () => {
  it("shows the empty state with no cards", () => {
    render(<ConsentCardsPane cards={[]} onConsent={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByTestId("consent-cards-empty")).toBeInTheDocument();
  });

  it("renders requester identity, request text, and matched item", () => {
    render(<ConsentCardsPane cards={[makeCard()]} onConsent={vi.fn()} onDecline={vi.fn()} />);
    const card = screen.getByTestId("consent-card-card-1");
    expect(card).toHaveTextContent("Anna");
    expect(card).toHaveTextContent("Hat wer einen Akkuschrauber?");
    expect(card).toHaveTextContent("Bosch IXO cordless screwdriver");
  });

  it("Yes posts the typed conditions", async () => {
    const user = userEvent.setup();
    const onConsent = vi.fn().mockResolvedValue(undefined);
    render(<ConsentCardsPane cards={[makeCard()]} onConsent={onConsent} onDecline={vi.fn()} />);

    const card = screen.getByTestId("consent-card-card-1");
    await user.type(within(card).getByTestId("consent-conditions"), "back by Sunday");
    await user.click(within(card).getByTestId("consent-yes"));

    expect(onConsent).toHaveBeenCalledWith("card-1", "back by Sunday");
  });

  it("Yes with no conditions posts undefined conditions", async () => {
    const user = userEvent.setup();
    const onConsent = vi.fn().mockResolvedValue(undefined);
    render(<ConsentCardsPane cards={[makeCard()]} onConsent={onConsent} onDecline={vi.fn()} />);
    await user.click(screen.getByTestId("consent-yes"));
    expect(onConsent).toHaveBeenCalledWith("card-1", undefined);
  });

  it("No declines the card", async () => {
    const user = userEvent.setup();
    const onDecline = vi.fn().mockResolvedValue(undefined);
    render(<ConsentCardsPane cards={[makeCard()]} onConsent={vi.fn()} onDecline={onDecline} />);
    await user.click(screen.getByTestId("consent-no"));
    expect(onDecline).toHaveBeenCalledWith("card-1");
  });

  it("shows the relay hint for relay-kind cards", () => {
    render(<ConsentCardsPane cards={[makeCard({ kind: "relay" })]} onConsent={vi.fn()} onDecline={vi.fn()} />);
    expect(screen.getByTestId("consent-card-relay-hint-card-1")).toHaveTextContent(/forward a friend's note/i);
  });

  it("renders an inactive card greyed with no action buttons", () => {
    render(<ConsentCardsPane cards={[makeCard({ state: "inactive" })]} onConsent={vi.fn()} onDecline={vi.fn()} />);
    const card = screen.getByTestId("consent-card-card-1");
    expect(card).toHaveClass("consent-card--inactive");
    expect(card).toHaveTextContent("request no longer active");
    expect(within(card).queryByTestId("consent-yes")).not.toBeInTheDocument();
    expect(within(card).queryByTestId("consent-no")).not.toBeInTheDocument();
  });

  it("shows an inline error and keeps the typed conditions when Yes fails", async () => {
    const user = userEvent.setup();
    const onConsent = vi.fn().mockRejectedValue(new Error("network down"));
    render(<ConsentCardsPane cards={[makeCard()]} onConsent={onConsent} onDecline={vi.fn()} />);

    const card = screen.getByTestId("consent-card-card-1");
    const conditionsInput = within(card).getByTestId("consent-conditions") as HTMLInputElement;
    await user.type(conditionsInput, "back by Sunday");
    await user.click(within(card).getByTestId("consent-yes"));

    expect(await within(card).findByTestId("action-error")).toHaveTextContent(
      "Couldn't reach your agent — try again.",
    );
    expect(conditionsInput.value).toBe("back by Sunday");
  });

  it("shows an inline error when No fails", async () => {
    const user = userEvent.setup();
    const onDecline = vi.fn().mockRejectedValue(new Error("network down"));
    render(<ConsentCardsPane cards={[makeCard()]} onConsent={vi.fn()} onDecline={onDecline} />);

    const card = screen.getByTestId("consent-card-card-1");
    await user.click(within(card).getByTestId("consent-no"));

    expect(await within(card).findByTestId("action-error")).toHaveTextContent(
      "Couldn't reach your agent — try again.",
    );
    // The card is still actionable (not silently marked declined on failure).
    expect(within(card).getByTestId("consent-yes")).toBeInTheDocument();
  });

  it("clears the error once the conditions are edited again", async () => {
    const user = userEvent.setup();
    const onConsent = vi.fn().mockRejectedValue(new Error("network down"));
    render(<ConsentCardsPane cards={[makeCard()]} onConsent={onConsent} onDecline={vi.fn()} />);

    const card = screen.getByTestId("consent-card-card-1");
    await user.click(within(card).getByTestId("consent-yes"));
    expect(await within(card).findByTestId("action-error")).toBeInTheDocument();

    await user.type(within(card).getByTestId("consent-conditions"), "x");
    expect(within(card).queryByTestId("action-error")).not.toBeInTheDocument();
  });
});
