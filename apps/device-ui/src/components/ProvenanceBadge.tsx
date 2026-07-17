import type { Item, TrustEdge } from "../types";

export interface ProvenanceBadgeProps {
  item: Item;
  trustEdges: TrustEdge[];
}

/** I8: items record `self` vs `second_brain (told by A)`. */
export function ProvenanceBadge({ item, trustEdges }: ProvenanceBadgeProps) {
  const testId = `provenance-badge-${item.id}`;

  const provenance = item.provenance;

  if (provenance.kind === "self") {
    return (
      <span data-testid={testId} className="provenance-badge provenance-badge--self">
        mine
      </span>
    );
  }

  const owner = trustEdges.find((edge) => edge.peer === provenance.owner)?.display ?? provenance.owner;
  return (
    <span data-testid={testId} className="provenance-badge provenance-badge--second-brain">
      noted: told by {owner}
    </span>
  );
}
