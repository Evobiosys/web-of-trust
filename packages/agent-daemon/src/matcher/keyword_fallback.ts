// Keyword fallback — matcher chain stage 3, used when ollama is entirely
// unreachable (no LLM at all — CLAUDE.md architecture note: "Demo must
// survive with no LLM at all"). Normalized token overlap + a small de/en
// synonym table for household tools (extendable JSON file, synonyms.json).
import defaultSynonyms from "./synonyms.json" with { type: "json" };

export type SynonymTable = Record<string, string[]>;

export interface KeywordMatchable {
  id: string;
  labels: string[];
  description: string;
  tags: string[];
}

export interface KeywordMatchResult {
  item_id: string;
  score: number;
  matchedConcepts: string[];
}

/** Lowercase, strip diacritics/punctuation, collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeText(text).split(" ").filter((t) => t.length > 0));
}

/** Which synonym-table concept groups (e.g. "akkuschrauber") appear as a phrase in `text`. */
function conceptsIn(text: string, table: SynonymTable): Set<string> {
  const padded = ` ${normalizeText(text)} `;
  const concepts = new Set<string>();
  for (const [group, terms] of Object.entries(table)) {
    for (const term of terms) {
      if (padded.includes(` ${normalizeText(term)} `)) {
        concepts.add(group);
        break;
      }
    }
  }
  return concepts;
}

/**
 * Ranks items by overlap with `queryText` against a synonym-aware concept
 * match (weighted higher, since it's the de<->en bridge) plus a plain
 * normalized-token overlap (skips short stopword-ish tokens, length <= 2).
 * Returns only items with score > 0, best first. Empty array = no match.
 */
export function keywordMatch(
  queryText: string,
  items: KeywordMatchable[],
  synonyms: SynonymTable = defaultSynonyms as SynonymTable
): KeywordMatchResult[] {
  const queryConcepts = conceptsIn(queryText, synonyms);
  const queryTokens = tokenSet(queryText);

  const results = items.map((item): KeywordMatchResult => {
    const itemText = [...item.labels, item.description, ...item.tags].join(" ");
    const itemConcepts = conceptsIn(itemText, synonyms);
    const itemTokens = tokenSet(itemText);

    const matchedConcepts = [...queryConcepts].filter((c) => itemConcepts.has(c));
    const tokenOverlap = [...queryTokens].filter((t) => t.length > 2 && itemTokens.has(t));

    return { item_id: item.id, score: matchedConcepts.length * 2 + tokenOverlap.length, matchedConcepts };
  });

  return results.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}
