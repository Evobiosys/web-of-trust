// Canonical "what text do we embed for an item" rule — shared by
// record_embeddings.ts (records real vectors once) and matcher.ts (embeds
// queries + looks up/embeds item vectors at match time), so the two never
// drift apart.
import type { Item } from "@resource-web/protocol";

export function itemEmbeddingText(item: Pick<Item, "labels" | "description">): string {
  return [...item.labels, item.description].join(". ");
}
