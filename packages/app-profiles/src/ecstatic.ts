import type { AppProfile } from "./types.js";

/** Dark, dance-floor skin for the ecstatic-dance community. Matches the
 * synchrolabs walking-skeleton dark aesthetic (near-black bg, near-white
 * text, one warm accent). No `mobile` field: this is mobile-ui's shipped
 * default appearance, not a derived skin — see task-7 report. */
export const ecstaticProfile: AppProfile = {
  id: "ecstatic",
  brandName: "Ecstatic World",
  heading: "What does the dance need right now?",
  subheading: "Ask the field — floor space, rides, hosting, hands.",
  theme: { accent: "fuchsia-500", bg: "zinc-950", isDark: true },
  suggestionGroups: [
    {
      label: "Events",
      icon: "sparkles",
      highlight: "What's moving this week?",
      items: [
        "Is there a jam this weekend?",
        "Who's hosting the next ecstatic dance?",
        "Any sunrise sessions coming up?",
      ],
    },
    {
      label: "Hosting",
      icon: "home",
      highlight: "Space for the dance",
      items: [
        "Who has floor space for a small jam?",
        "I need a room for ~20 dancers Saturday",
        "Anyone with a garden for an outdoor session?",
      ],
    },
    {
      label: "Rides",
      icon: "users",
      highlight: "Getting there together",
      items: [
        "Anyone driving to the venue from the west side?",
        "I can offer 2 seats to tonight's jam",
        "Need a ride back after the dance",
      ],
    },
    {
      label: "Floor & gear",
      icon: "hand-heart",
      highlight: "What the space needs",
      items: [
        "Who has a sound system to lend?",
        "Need extra cushions or mats for the floor",
        "Anyone with candles or floor lamps to share?",
      ],
    },
  ],
  defaultPolicy: { audience: "trusted", mode: "ask_each_time" },
  hidden: ["audit"],
  quickAdds: [
    { label: "I have floor space", stewardText: "I have floor space available for ecstatic dance sessions" },
    { label: "I can drive", stewardText: "I can offer a ride to/from the dance" },
    { label: "I have a sound system", stewardText: "I have a sound system I can lend for events" },
  ],
};
