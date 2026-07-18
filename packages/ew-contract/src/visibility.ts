/**
 * {DIS-3} The invisibility predicate. HARD RULE: when this returns false the item
 * does not exist for the viewer — no locked card, no teaser, no count, no residue.
 * Where this predicate is EVALUATED (client / relay / service) is ADR-1 (OPEN);
 * its semantics are fixed here.
 */
import {
  Edge,
  EventRecord,
  Level,
  LEVEL_ORDER,
  Offer,
  PersonId,
  RelState,
  Tier,
  TIER_MIN_LEVEL,
  effectiveLevel,
} from "./types.js";

export interface TrustGraph {
  edges: Edge[];
}

function usable(e: Edge, min: Level): boolean {
  return e.state === ("mutual" as RelState) && LEVEL_ORDER[effectiveLevel(e)] >= LEVEL_ORDER[min];
}

/**
 * True iff a path viewer→(any host) exists with path length ≤ steps where EVERY hop
 * is a mutual edge whose effective level ≥ the tier's minimum. BFS.
 */
export function pathReaches(
  graph: TrustGraph,
  viewer: PersonId,
  targets: PersonId[],
  minLevel: Level,
  steps: number
): boolean {
  if (targets.includes(viewer)) return true;
  const targetSet = new Set(targets);
  let frontier = new Set<PersonId>([viewer]);
  const seen = new Set<PersonId>([viewer]);
  for (let depth = 0; depth < steps; depth++) {
    const next = new Set<PersonId>();
    for (const node of frontier) {
      for (const e of graph.edges) {
        if (!usable(e, minLevel)) continue;
        const other = e.a === node ? e.b : e.b === node ? e.a : null;
        if (!other || seen.has(other)) continue;
        if (targetSet.has(other)) return true;
        seen.add(other);
        next.add(other);
      }
    }
    if (next.size === 0) return false;
    frontier = next;
  }
  return false;
}

export function eventVisible(graph: TrustGraph, viewer: PersonId | null, ev: EventRecord): boolean {
  if (ev.tier === "public") return true;
  if (viewer === null) return false; // guests see only the public tier {DIS-5}
  const min = TIER_MIN_LEVEL[ev.tier as Exclude<Tier, "public">];
  return pathReaches(graph, viewer, ev.hostIds, min, ev.steps);
}

/** Offers use the SAME predicate; anonymous offers gate via the mutual (viaId). */
export function offerVisible(graph: TrustGraph, viewer: PersonId | null, offer: Offer): boolean {
  if (viewer === null) return false;
  if (offer.mine) return true;
  const min = TIER_MIN_LEVEL[offer.tier];
  const anchors = offer.identityWithheld
    ? offer.viaId
      ? [offer.viaId]
      : []
    : offer.ownerId
      ? [offer.ownerId]
      : [];
  const direct = anchors.length > 0 && pathReaches(graph, viewer, anchors, min, offer.steps ?? 2);
  if (direct) return true;
  // owner-approved second-degree extensions reach one ring further through the via person {RES-6}
  if (offer.extendedVia?.length) {
    return pathReaches(graph, viewer, offer.extendedVia, min, 1);
  }
  return false;
}
