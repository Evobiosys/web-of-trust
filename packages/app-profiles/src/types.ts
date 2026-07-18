/**
 * App-profile (skin) types, shared by device-ui and mobile-ui. A profile is
 * a client-side-only presentation layer: copy, theme, suggested prompts,
 * quick-add shortcuts, and which panes are hidden. It never changes
 * daemon-side policy — the `defaultPolicy` field is a copy source for a UI
 * indicator only (see task-3 brief §"defaultPolicy applies..."); actual
 * per-item policy setting stays server-side (I9 conservative defaults) and
 * is a FUTURE.md item.
 */

export interface SuggestionGroup {
  label: string;
  icon: "sparkles" | "home" | "users" | "user" | "hand-heart";
  highlight: string;
  items: string[];
}

/**
 * Mobile-ui-specific skin knobs, additive on top of the shared AppProfile
 * shape (task-7). Optional throughout so device-ui (which ignores this
 * field entirely) is unaffected. Absent/undefined fields mean "mobile-ui's
 * existing default behavior" — the ecstatic profile ships with no `mobile`
 * field for exactly that reason.
 */
export interface MobileSkin {
  /** Which Discover segment is active by default. Undefined = today's default (gatherings). */
  discoverDefault?: "gatherings" | "offers";
  /** Replaces the four genre chips under Discover (the "This week" filter chip is untouched). */
  offerChips?: string[];
  /** Replaces the Discover screen's "＋ Host" FAB label. */
  hostFabLabel?: string;
  /** Replaces the Meet ceremony's default offered trust level (otherwise "Contact"). */
  defaultMeetLevel?: "Contact" | "Friend" | "Close friend";
  /** Replaces the celebration screen's "Woven." heading. */
  celebrateWord?: string;
}

export interface AppProfile {
  id: "ecstatic" | "housing" | "family" | "business";
  brandName: string; // header text, e.g. "Ecstatic World"
  heading: string; // centered landing heading
  subheading?: string;
  theme: { accent: string; bg: string; isDark: boolean }; // tailwind token strings
  suggestionGroups: SuggestionGroup[];
  defaultPolicy: { audience: "private" | "trusted" | "wot_commons"; mode: "ask_each_time" | "auto_forward" };
  hidden: Array<"inventory" | "notes" | "trust" | "audit">; // panes hidden in this skin
  quickAdds: Array<{ label: string; stewardText: string }>; // one-tap resource capture, sent to POST /api/steward
  /** Optional mobile-ui skin overrides (task-7). See {@link MobileSkin}. */
  mobile?: MobileSkin;
}
