import type { AppProfile } from "./types";

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
};
