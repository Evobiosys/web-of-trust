import type { Item, TrustEdge } from "../types";
import { ProvenanceBadge } from "./ProvenanceBadge";

export interface InventoryPaneProps {
  items: Item[];
  trustEdges: TrustEdge[];
}

function formatRequires(requires: Item["policy"]["requires"]): string | null {
  if (!requires || requires.length === 0) return null;
  return requires.map((r) => r.replace(/_/g, " ")).join(", ");
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function InventoryPane({ items, trustEdges }: InventoryPaneProps) {
  return (
    <section className="pane" data-testid="inventory-pane" aria-label="Map of my things">
      <h2 className="pane__title">Map of my things</h2>

      {items.length === 0 ? (
        <p className="empty-state" data-testid="inventory-empty">
          No items yet — tell your steward what you have.
        </p>
      ) : (
        <ul className="item-list">
          {items.map((item) => {
            const requires = formatRequires(item.policy.requires);
            return (
              <li key={item.id} className="item-card" data-testid={`item-card-${item.id}`}>
                <div className="item-card__header">
                  <strong>{item.labels.join(", ")}</strong>
                  <ProvenanceBadge item={item} trustEdges={trustEdges} />
                </div>
                <p className="item-card__description">{item.description}</p>
                {item.tags.length > 0 && (
                  <p className="item-card__tags">
                    {item.tags.map((tag) => (
                      <span key={tag} className="tag-pill">
                        {tag}
                      </span>
                    ))}
                  </p>
                )}
                <dl className="item-card__meta">
                  {item.location_area && (
                    <>
                      <dt>Area</dt>
                      <dd>{item.location_area}</dd>
                    </>
                  )}
                  {item.availability && (
                    <>
                      <dt>Availability</dt>
                      <dd>{item.availability}</dd>
                    </>
                  )}
                  <dt>Audience</dt>
                  <dd>{item.policy.audience}</dd>
                  <dt>Sharing mode</dt>
                  <dd>{item.policy.mode === "ask_each_time" ? "ask each time" : "auto-forward"}</dd>
                  {requires && (
                    <>
                      <dt>Requires</dt>
                      <dd>{requires}</dd>
                    </>
                  )}
                  <dt>Policy expires</dt>
                  <dd>{formatDate(item.policy.expires_at)}</dd>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
