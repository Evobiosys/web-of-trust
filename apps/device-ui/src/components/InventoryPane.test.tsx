import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InventoryPane } from "./InventoryPane";
import type { Item, TrustEdge } from "../types";

const trustEdges: TrustEdge[] = [{ peer: "@timo-agent:wot.local", display: "Timo", created_at: "2026-01-01T00:00:00.000Z" }];

describe("InventoryPane", () => {
  it("shows the empty state with no items", () => {
    render(<InventoryPane items={[]} trustEdges={[]} />);
    expect(screen.getByTestId("inventory-empty")).toBeInTheDocument();
  });

  it("renders an item card with labels, description, tags, availability, and area", () => {
    const item: Item = {
      id: "item-1",
      labels: ["Bosch IXO cordless screwdriver"],
      description: "barely used",
      tags: ["tools", "cordless"],
      provenance: { kind: "self" },
      policy: { audience: "trusted", mode: "ask_each_time", expires_at: "2027-01-01T00:00:00.000Z" },
      location_area: "Wien-Ottakring",
      availability: "evenings",
    };
    render(<InventoryPane items={[item]} trustEdges={[]} />);

    const card = screen.getByTestId("item-card-item-1");
    expect(card).toHaveTextContent("Bosch IXO cordless screwdriver");
    expect(card).toHaveTextContent("barely used");
    expect(card).toHaveTextContent("tools");
    expect(card).toHaveTextContent("Wien-Ottakring");
    expect(card).toHaveTextContent("evenings");
    expect(card).toHaveTextContent("trusted");
    expect(card).toHaveTextContent("ask each time");
  });

  it("renders the self provenance badge as 'mine'", () => {
    const item: Item = {
      id: "item-1",
      labels: ["thing"],
      description: "d",
      tags: [],
      provenance: { kind: "self" },
      policy: { audience: "trusted", mode: "ask_each_time" },
    };
    render(<InventoryPane items={[item]} trustEdges={[]} />);
    expect(screen.getByTestId("provenance-badge-item-1")).toHaveTextContent("mine");
  });

  it("renders the second_brain provenance badge resolving the owner's display name", () => {
    const item: Item = {
      id: "item-2",
      labels: ["3m ladder"],
      description: "d",
      tags: [],
      provenance: { kind: "second_brain", owner: "@timo-agent:wot.local", noted_at: "2026-01-01T00:00:00.000Z" },
      policy: { audience: "trusted", mode: "ask_each_time" },
    };
    render(<InventoryPane items={[item]} trustEdges={trustEdges} />);
    expect(screen.getByTestId("provenance-badge-item-2")).toHaveTextContent("noted: told by Timo");
  });
});
