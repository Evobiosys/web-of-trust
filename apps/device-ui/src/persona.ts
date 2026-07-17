export type PersonaKey = "anna" | "ben" | "timo";

export interface PersonaTheme {
  accentClass: string;
  displayName: string;
}

const THEMES: Record<PersonaKey, PersonaTheme> = {
  anna: { accentClass: "accent-warm", displayName: "Anna" },
  ben: { accentClass: "accent-cool", displayName: "Ben" },
  timo: { accentClass: "accent-neutral", displayName: "Timo" },
};

const DEFAULT_THEME: PersonaTheme = { accentClass: "accent-neutral", displayName: "" };

/** Maps VITE_PERSONA (anna|ben|timo) to its accent theme + display name.
 * Unknown personas fall back to a neutral accent with the raw key as name. */
export function getPersonaTheme(personaKey: string): PersonaTheme {
  const known = THEMES[personaKey as PersonaKey];
  if (known) return known;
  return { ...DEFAULT_THEME, displayName: personaKey };
}
