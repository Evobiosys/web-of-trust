// D21 — permission gating (gating-ui branch): per-category x per-ring
// standing share defaults, promote-to-default slots for the composer's
// split-share-button, and cross-community forwarding rules with provenance.
// Pure state (no Store/clock/transport imports here on purpose — see
// permission_policy_store.ts for persistence, host.js/permission_policy_ui.js
// for the split-button + matrix UI this feeds).
//
// Builds on D14's listing vocabulary and D10's AppProfile.defaultPolicy,
// which FUTURE.md already named as the seed for exactly this feature
// ("Per-item SharePolicy editor driven by AppProfile.defaultPolicy...
// profiles are display-only today; D10") — createDefaultPolicy() below is
// the first thing that reads defaultPolicy as a seed rather than copy.
//
// Interpretation calls (documented per repo convention — see DECISIONS.md
// D21 for the numbered write-up):
//
// - Columns are the mobile-ui composer's four VIS audience rings
//   (pub/commons/friends/close — apps/mobile-ui/src/api_client.js's `VIS`),
//   NOT protocol's raw TrustLevel (contact/friend/close). VIS is one hop
//   from what host.js actually publishes at (via VIS_TO_TIER ->
//   SharePolicyAudienceSchema in api_client_live.js); TrustLevel is two.
// - `PolicyCategoryId` deliberately mirrors store/types.ts's `ListingKind`
//   ("offer" | "gathering") as its own literal union rather than importing
//   it, to keep this module import-free of the store layer (store/types.ts
//   imports THIS module's types for its persistence record, not the other
//   way — see permission_policy_store.ts). Same "presentational catalog,
//   kept in sync by hand" tradeoff api_client.js already makes for VIS/REACH.
//   "housing" is an AppProfile id (packages/app-profiles), not a
//   ListingKind — it does NOT belong in this union; see task report.
// - Cell states "share"/"ask"/"off" map onto existing SharePolicy atoms:
//   share -> SharePolicyModeSchema "auto_forward", ask -> "ask_each_time",
//   off -> tier "private" (daemon/listings.ts's levelSatisfiesTier already
//   returns false for "private" — reaches no one). "once" has NO SharePolicy
//   equivalent: it means "auto-forward the current listing to this ring one
//   time, then revert to whatever this cell was before." Recording it as a
//   standing matrix default is honest about what the UI shows and lets a
//   user set "once" as a category x ring default; actually ENFORCING the
//   one-shot revert at publish/broadcast time is NOT wired here (no
//   daemon/listings.ts change in this branch) — flagged in the task report
//   and left as a FUTURE.md follow-up, not silently implied.
// - Cross-community rules intentionally use a DIFFERENT vocabulary
//   (never/always/ask/once) and cycle order than the share matrix
//   (off/share/ask/once) — mirrors the reference prototype's two
//   independent state machines (draft-prototype/index.html sections 1 and
//   2 keep `wot.matrix` and `wot.comm` separate) and keeps "does a whole
//   community get a standing feed" from colliding with "does a person get
//   shared with."

/** The composer's four audience rings, narrow -> broad (matches the
 * reference prototype's Close..Public column order). Reuses api_client.js's
 * `VIS` key vocabulary verbatim so a ring here is never a re-derivation. */
export type AudienceRing = "close" | "friends" | "commons" | "pub";

export const RING_ORDER: readonly AudienceRing[] = ["close", "friends", "commons", "pub"];

/** Copy verbatim from apps/mobile-ui/src/api_client.js's `VIS` catalog (kept
 * in sync by hand, same tradeoff as that file's own fixture/live split). */
export const RING_LABEL: Record<AudienceRing, string> = {
  close: "Close friends",
  friends: "Friends",
  commons: "The Commons",
  pub: "Public",
};

/** See module doc comment: mirrors store/types.ts's `ListingKind` without
 * importing it. "gathering" | "offer" are the only real listing kinds today. */
export type PolicyCategoryId = "gathering" | "offer";

export const CATEGORY_ORDER: readonly PolicyCategoryId[] = ["gathering", "offer"];

export const CATEGORY_LABEL: Record<PolicyCategoryId, string> = {
  gathering: "Gatherings",
  offer: "Offers",
};

/** One matrix cell's standing default. Cycle order: off -> share -> ask ->
 * once -> off (the reference prototype's hint text reads "share -> ask ->
 * once -> off", describing the same cycle starting from `share`). */
export type ShareCellState = "off" | "share" | "ask" | "once";

export const SHARE_CYCLE: readonly ShareCellState[] = ["off", "share", "ask", "once"];

export function nextShareCellState(state: ShareCellState): ShareCellState {
  return SHARE_CYCLE[(SHARE_CYCLE.indexOf(state) + 1) % SHARE_CYCLE.length];
}

/** A cross-community forwarding rule. Its own vocabulary/order — see module
 * doc comment "Cross-community rules intentionally use a DIFFERENT...". */
export type CrossCommunityRule = "never" | "always" | "ask" | "once";

export const CROSS_COMMUNITY_CYCLE: readonly CrossCommunityRule[] = ["never", "always", "ask", "once"];

export function nextCrossCommunityRule(state: CrossCommunityRule): CrossCommunityRule {
  return CROSS_COMMUNITY_CYCLE[(CROSS_COMMUNITY_CYCLE.indexOf(state) + 1) % CROSS_COMMUNITY_CYCLE.length];
}

/** One category's (e.g. "gathering") full policy: the split-share-button's
 * primary + three configurable secondary rings, and the standing share
 * default for every ring (the full matrix row for this category). */
export interface CategoryPolicy {
  primaryRing: AudienceRing;
  secondaryRings: [AudienceRing, AudienceRing, AudienceRing];
  matrix: Record<AudienceRing, ShareCellState>;
}

export type PermissionPolicy = Record<PolicyCategoryId, CategoryPolicy>;

/** rings -> { communityId -> rule }, one map per category. Plain object (not
 * a nested Map) so it survives JSON.stringify verbatim for storage. */
export type CrossCommunityRules = Partial<Record<PolicyCategoryId, Record<string, CrossCommunityRule>>>;

function allOffMatrix(): Record<AudienceRing, ShareCellState> {
  return { close: "off", friends: "off", commons: "off", pub: "off" };
}

/** The three rings other than `ring`, in RING_ORDER — deterministic initial
 * secondary-slot assignment (a user can promote any of them afterward). */
function otherRings(ring: AudienceRing): [AudienceRing, AudienceRing, AudienceRing] {
  const rest = RING_ORDER.filter((r) => r !== ring);
  return rest as [AudienceRing, AudienceRing, AudienceRing];
}

/** AppProfile.defaultPolicy's shape (packages/app-profiles/src/types.ts),
 * duplicated as a structural type here rather than imported — app-profiles
 * has no runtime dependency on agent-daemon today and this module shouldn't
 * be the one to introduce it; the caller (permission_policy_store.ts or the
 * daemon wiring that reads a persona's active AppProfile) passes the field
 * across, already shaped like this. */
export interface ProfileDefaultPolicySeed {
  audience: "private" | "trusted" | "wot_commons";
  mode: "ask_each_time" | "auto_forward";
}

/** audience -> the ring it seeds. "private" seeds no ring (I9: nothing
 * shared by default) — createDefaultCategoryPolicy still needs *a* primary
 * ring for the split-button to point at, so it falls back to "close", the
 * narrowest/safest option, with that ring's own matrix cell left "off". */
const SEED_RING: Record<ProfileDefaultPolicySeed["audience"], AudienceRing | undefined> = {
  private: undefined,
  trusted: "friends",
  wot_commons: "commons",
};

/** Seeds one category's policy from an AppProfile.defaultPolicy value (I9
 * conservative defaults: every ring starts "off" except the seeded one). */
export function createDefaultCategoryPolicy(seed: ProfileDefaultPolicySeed): CategoryPolicy {
  const ring = SEED_RING[seed.audience] ?? "close";
  const matrix = allOffMatrix();
  if (SEED_RING[seed.audience] !== undefined) {
    matrix[ring] = seed.mode === "auto_forward" ? "share" : "ask";
  }
  return { primaryRing: ring, secondaryRings: otherRings(ring), matrix };
}

/** Seeds a full policy (every category gets the same seed — a persona
 * doesn't yet have per-category AppProfile.defaultPolicy values; callers
 * with per-category seeds should call createDefaultCategoryPolicy directly
 * per category instead). */
export function createDefaultPolicy(
  seed: ProfileDefaultPolicySeed,
  categories: readonly PolicyCategoryId[] = CATEGORY_ORDER
): PermissionPolicy {
  const policy = {} as PermissionPolicy;
  for (const category of categories) {
    policy[category] = createDefaultCategoryPolicy(seed);
  }
  return policy;
}

/** Cycle one matrix cell (category x ring) to its next ShareCellState.
 * Pure/immutable: returns a new PermissionPolicy, leaves slots untouched. */
export function cycleShareCell(policy: PermissionPolicy, category: PolicyCategoryId, ring: AudienceRing): PermissionPolicy {
  const current = policy[category];
  return {
    ...policy,
    [category]: {
      ...current,
      matrix: { ...current.matrix, [ring]: nextShareCellState(current.matrix[ring]) },
    },
  };
}

/** Promote one of the three secondary slots to primary — a SWAP (the old
 * primary takes the promoted slot's place), not an overwrite, and it never
 * touches `matrix`. Pure/immutable. */
export function promoteToDefault(policy: PermissionPolicy, category: PolicyCategoryId, slotIndex: 0 | 1 | 2): PermissionPolicy {
  const current = policy[category];
  const secondaryRings: [AudienceRing, AudienceRing, AudienceRing] = [...current.secondaryRings];
  const promoted = secondaryRings[slotIndex];
  secondaryRings[slotIndex] = current.primaryRing;
  return { ...policy, [category]: { ...current, primaryRing: promoted, secondaryRings } };
}

export function emptyCrossCommunityRules(): CrossCommunityRules {
  return {};
}

export function getCrossCommunityRule(rules: CrossCommunityRules, category: PolicyCategoryId, communityId: string): CrossCommunityRule {
  return rules[category]?.[communityId] ?? "never";
}

/** Cycle one (category, community) cross-community cell. Pure/immutable. */
export function cycleCrossCommunityRule(rules: CrossCommunityRules, category: PolicyCategoryId, communityId: string): CrossCommunityRules {
  const current = getCrossCommunityRule(rules, category, communityId);
  const catRules = rules[category] ?? {};
  return { ...rules, [category]: { ...catRules, [communityId]: nextCrossCommunityRule(current) } };
}

/** Sets a specific rule (not a cycle step) — used by the "set default"
 * affordance and by tests. Pure/immutable. */
export function setCrossCommunityRule(
  rules: CrossCommunityRules,
  category: PolicyCategoryId,
  communityId: string,
  rule: CrossCommunityRule
): CrossCommunityRules {
  const catRules = rules[category] ?? {};
  return { ...rules, [category]: { ...catRules, [communityId]: rule } };
}

/**
 * Provenance for a cross-community rule change, shaped for
 * `audit/audit.ts`'s `logOwner(store, clock, requestId, action, detail)` —
 * this is how the reference prototype's "receiving side sees provenance"
 * is expressed in this codebase (I6: every agent decision logged locally,
 * human-readable), rather than inventing a bespoke provenance field.
 * Callers: `logOwner(store, clock, describeCrossCommunityChange(evt).requestId, ...)`.
 */
export function describeCrossCommunityChange(evt: {
  category: PolicyCategoryId;
  communityId: string;
  rule: CrossCommunityRule;
}): { requestId: string; action: string; detail: string } {
  return {
    requestId: `policy:${evt.category}:${evt.communityId}`,
    action: "cross_community_rule_set",
    detail: `Set ${CATEGORY_LABEL[evt.category]} -> ${evt.communityId} to "${evt.rule}".`,
  };
}
