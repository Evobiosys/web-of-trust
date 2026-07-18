/**
 * App-profile (skin) types for device-ui. A profile is a client-side-only
 * presentation layer: copy, theme, suggested prompts, quick-add shortcuts,
 * and which panes are hidden. It never changes daemon-side policy — the
 * `defaultPolicy` field is a copy source for a UI indicator only (see
 * task-3 brief §"defaultPolicy applies..."); actual per-item policy setting
 * stays server-side (I9 conservative defaults) and is a FUTURE.md item.
 */

export interface SuggestionGroup {
  label: string;
  icon: "sparkles" | "home" | "users" | "user" | "hand-heart";
  highlight: string;
  items: string[];
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
}
