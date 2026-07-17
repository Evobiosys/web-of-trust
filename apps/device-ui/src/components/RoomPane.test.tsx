import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoomPane } from "./RoomPane";
import type { Room } from "../types";

const room: Room = {
  room_id: "room-1",
  peers: [
    { peer_id: "@anna-agent:wot.local", display: "Anna" },
    { peer_id: "@ben-agent:wot.local", display: "Ben" },
  ],
  messages: [{ from: "Ben", text: "Happy to lend it!", ts: "2026-01-01T00:00:00.000Z" }],
  context: "Bosch IXO cordless screwdriver",
};

describe("RoomPane", () => {
  it("shows the empty state with no rooms", () => {
    render(<RoomPane rooms={[]} onSendMessage={vi.fn()} />);
    expect(screen.getByTestId("room-pane-empty")).toBeInTheDocument();
  });

  it("renders room messages", () => {
    render(<RoomPane rooms={[room]} onSendMessage={vi.fn()} />);
    expect(screen.getByTestId("room-messages")).toHaveTextContent("Happy to lend it!");
  });

  it("sends a composed message to the active room", async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    render(<RoomPane rooms={[room]} onSendMessage={onSendMessage} />);

    await user.type(screen.getByTestId("room-message-input"), "Thank you!");
    await user.click(screen.getByTestId("room-send"));

    expect(onSendMessage).toHaveBeenCalledWith("room-1", "Thank you!");
  });

  it("shows an inline error and preserves the draft when sending fails", async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn().mockRejectedValue(new Error("network down"));
    render(<RoomPane rooms={[room]} onSendMessage={onSendMessage} />);

    const input = screen.getByTestId("room-message-input") as HTMLInputElement;
    await user.type(input, "Thank you!");
    await user.click(screen.getByTestId("room-send"));

    expect(await screen.findByTestId("action-error")).toHaveTextContent("Couldn't reach your agent — try again.");
    expect(input.value).toBe("Thank you!");
  });

  it("clears the error once the draft is edited again", async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn().mockRejectedValue(new Error("network down"));
    render(<RoomPane rooms={[room]} onSendMessage={onSendMessage} />);

    await user.type(screen.getByTestId("room-message-input"), "hi");
    await user.click(screen.getByTestId("room-send"));
    expect(await screen.findByTestId("action-error")).toBeInTheDocument();

    await user.type(screen.getByTestId("room-message-input"), "!");
    expect(screen.queryByTestId("action-error")).not.toBeInTheDocument();
  });
});
