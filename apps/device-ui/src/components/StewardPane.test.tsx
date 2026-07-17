import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { StewardPane } from "./StewardPane";
import type { Ask, StewardLogEntry } from "../types";

describe("StewardPane", () => {
  it("shows the empty state when there is no log yet", () => {
    render(<StewardPane log={[]} asks={[]} onSend={vi.fn()} />);
    expect(screen.getByTestId("steward-log-empty")).toBeInTheDocument();
  });

  it("renders steward_log messages", () => {
    const log: StewardLogEntry[] = [
      { role: "user", text: "Hat wer einen Akkuschrauber?", ts: "2026-01-01T00:00:00.000Z" },
      { role: "agent", text: "Asked 1 trusted people nearby. You'll hear back.", ts: "2026-01-01T00:00:01.000Z" },
    ];
    render(<StewardPane log={log} asks={[]} onSend={vi.fn()} />);
    const logEl = screen.getByTestId("steward-log");
    expect(within(logEl).getByText("Hat wer einen Akkuschrauber?")).toBeInTheDocument();
    expect(within(logEl).getByText("Asked 1 trusted people nearby. You'll hear back.")).toBeInTheDocument();
  });

  it("sends the composed text and clears the input", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<StewardPane log={[]} asks={[]} onSend={onSend} />);

    const input = screen.getByTestId("steward-input") as HTMLInputElement;
    await user.type(input, "Hat wer einen Akkuschrauber?");
    await user.click(screen.getByTestId("steward-send"));

    expect(onSend).toHaveBeenCalledWith("Hat wer einen Akkuschrauber?");
    expect(input.value).toBe("");
  });

  it("disables send while the input is empty", () => {
    render(<StewardPane log={[]} asks={[]} onSend={vi.fn()} />);
    expect(screen.getByTestId("steward-send")).toBeDisabled();
  });

  it("renders an ask chip per ask, and a send round-trip renders the agent's reply", async () => {
    const asks: Ask[] = [
      { request_id: "req-1", text: "Hat wer einen Akkuschrauber?", created_at: "2026-01-01T00:00:00.000Z", state: "waiting", queried_count: 1 },
    ];

    function Harness() {
      const [log, setLog] = useState<StewardLogEntry[]>([]);
      const onSend = async (text: string) => {
        setLog((prev) => [
          ...prev,
          { role: "user", text, ts: "t1" },
          { role: "agent", text: "hi back", ts: "t2" },
        ]);
      };
      return <StewardPane log={log} asks={asks} onSend={onSend} />;
    }

    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByTestId("ask-chip-req-1")).toBeInTheDocument();
    expect(screen.getByTestId("ask-chip-req-1")).toHaveTextContent("Asked 1 trusted people nearby. You'll hear back.");

    await user.type(screen.getByTestId("steward-input"), "hi");
    await user.click(screen.getByTestId("steward-send"));

    expect(await screen.findByText("hi back")).toBeInTheDocument();
  });

  it("shows an inline error and preserves the draft when onSend rejects", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockRejectedValue(new Error("network down"));
    render(<StewardPane log={[]} asks={[]} onSend={onSend} />);

    const input = screen.getByTestId("steward-input") as HTMLInputElement;
    await user.type(input, "Hat wer einen Akkuschrauber?");
    await user.click(screen.getByTestId("steward-send"));

    expect(await screen.findByTestId("action-error")).toHaveTextContent("Couldn't reach your agent — try again.");
    // The draft is preserved — nothing was sent, nothing should be lost.
    expect(input.value).toBe("Hat wer einen Akkuschrauber?");
  });

  it("clears the error once the user edits the draft again", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockRejectedValue(new Error("network down"));
    render(<StewardPane log={[]} asks={[]} onSend={onSend} />);

    await user.type(screen.getByTestId("steward-input"), "hi");
    await user.click(screen.getByTestId("steward-send"));
    expect(await screen.findByTestId("action-error")).toBeInTheDocument();

    await user.type(screen.getByTestId("steward-input"), "!");
    expect(screen.queryByTestId("action-error")).not.toBeInTheDocument();
  });
});
