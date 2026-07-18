import type { AppProfile } from "./types.js";

/** Neutral, professional skin for colleagues/acquaintances sharing
 * skills, space and equipment. Hides both `notes` (too informal for this
 * audience) and `audit`. */
export const businessProfile: AppProfile = {
  id: "business",
  brandName: "Peer Desk",
  heading: "What does your network need this week?",
  subheading: "Share resources with trusted colleagues and acquaintances.",
  theme: { accent: "sky-700", bg: "slate-50", isDark: false },
  suggestionGroups: [
    {
      label: "Skills",
      icon: "user",
      highlight: "Expertise on tap",
      items: [
        "Anyone free for a 30-min review of my pitch deck?",
        "Need someone with contract-law experience",
        "Looking for a beta tester for a new tool",
      ],
    },
    {
      label: "Space",
      icon: "home",
      highlight: "Meeting & desk space",
      items: [
        "Who has a meeting room free Thursday?",
        "Need a quiet desk for a day",
        "Anyone with a spare co-working seat?",
      ],
    },
    {
      label: "Equipment",
      icon: "hand-heart",
      highlight: "Gear & tools",
      items: [
        "Anyone have a spare monitor to lend?",
        "Need a projector for a workshop",
        "Looking for a badge printer for one day",
      ],
    },
  ],
  defaultPolicy: { audience: "trusted", mode: "ask_each_time" },
  hidden: ["notes", "audit"],
  quickAdds: [
    { label: "I have meeting space", stewardText: "I have meeting/desk space available to lend" },
    { label: "I can offer 30 min expertise", stewardText: "I can offer 30 minutes of expertise/advice this week" },
    {
      label: "I have spare equipment",
      stewardText: "I have spare equipment (monitor/projector/etc.) to lend",
    },
  ],
  mobile: {
    defaultMeetLevel: "Contact",
    celebrateWord: "Connected.",
  },
};
