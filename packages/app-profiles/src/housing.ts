import type { AppProfile } from "./types.js";

/** Light, warm skin for short-notice housing/couch-surfing sharing.
 * Bilingual German/English copy per brief — this community organizes in
 * German with English speakers mixed in. */
export const housingProfile: AppProfile = {
  id: "housing",
  brandName: "Roof",
  heading: "Wer hat ein Dach frei? / Who has a roof to share?",
  subheading: "Kurzfristig unterkommen oder Platz anbieten. / Find or offer a short stay.",
  theme: { accent: "amber-600", bg: "amber-50", isDark: false },
  suggestionGroups: [
    {
      label: "Suche",
      icon: "home",
      highlight: "Ich brauche ein Dach",
      items: [
        "Wer kann mich nächstes Wochenende in Wien unterbringen?",
        "Ich brauche 2 Nächte Couch in Graz",
        "Suche ein WG-Zimmer für eine Woche",
      ],
    },
    {
      label: "Angebot",
      icon: "hand-heart",
      highlight: "Ich habe Platz",
      items: [
        "Ich habe ein Gästezimmer frei",
        "Couch für 1 Person diese Woche frei",
        "Wohnung frei über die Feiertage",
      ],
    },
    {
      label: "Umzug",
      icon: "users",
      highlight: "Hilfe beim Umzug",
      items: [
        "Wer hilft mir beim Umzug am Samstag?",
        "Brauche einen Transporter für 2 Stunden",
        "Hat jemand übrige Umzugskartons?",
      ],
    },
  ],
  defaultPolicy: { audience: "trusted", mode: "ask_each_time" },
  hidden: ["audit"],
  quickAdds: [
    {
      label: "I can host 1–2 guests",
      stewardText: "I can host 1-2 guests in my apartment (couch/guest room), short stays",
    },
    { label: "I need a place this weekend", stewardText: "I need a place to stay this weekend" },
    { label: "I have a spare room", stewardText: "I have a spare room free for the next while" },
  ],
  mobile: {
    discoverDefault: "offers",
    // No offerChips override: those relabel the Gatherings tab's genre/
    // category filter chips (see MobileSkin's doc comment), not the Offers
    // list itself. mobile-ui's own shared fallback ("Flat viewings /
    // Neighbourhood / Moving help / Hangouts", see index.html) already fits
    // this profile's own gatherings-frame Discover content better than a
    // couch-surfing-specific set would, so there's nothing for housing to
    // override here.
    hostFabLabel: "＋ Offer housing",
    // English-only: mobile-ui has no language toggle (unlike device-ui and
    // apps/web, where `heading` above is read directly), so the bilingual
    // "Wer hat ein Dach frei? / Who has a roof to share?" would be the only
    // German on an otherwise all-English screen. Doesn't touch `heading`
    // itself — profiles.test.ts pins /Dach/ and /roof/i on it for the apps
    // that do use it as-is.
    onboardingHeading: "Ask the people you actually know.",
  },
};
