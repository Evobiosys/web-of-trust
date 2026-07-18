import type { AppProfile } from "./types.js";

/** Warm, close-trust skin for a family/household circle. Default policy
 * mode is `auto_forward` — this circle is close enough that per-request
 * confirmation is friction, not safety (still `audience: "trusted"`, still
 * server-side conservative default underneath — see task-3 brief §"defaultPolicy
 * applies..."). */
export const familyProfile: AppProfile = {
  id: "family",
  brandName: "Family Circle",
  heading: "What does the circle need this week?",
  subheading: "For the people you trust with everything.",
  theme: { accent: "emerald-600", bg: "emerald-50", isDark: false },
  suggestionGroups: [
    {
      label: "Kids",
      icon: "users",
      highlight: "Kids & care",
      items: [
        "Who can pick up the kids on Thursday?",
        "Need a sitter Friday evening",
        "Anyone free for a playdate this week?",
      ],
    },
    {
      label: "Meals",
      icon: "hand-heart",
      highlight: "Food & meals",
      items: [
        "Cooking extra tonight, who wants a plate?",
        "Need a meal train for next week",
        "Anyone have spare garden veggies?",
      ],
    },
    {
      label: "Household",
      icon: "home",
      highlight: "Around the house",
      items: ["Can someone lend a ladder this weekend?", "Need help moving furniture", "Borrowing the car Saturday?"],
    },
  ],
  defaultPolicy: { audience: "trusted", mode: "auto_forward" },
  hidden: ["audit"],
  quickAdds: [
    { label: "I can pick up kids", stewardText: "I can pick up the kids from school this week" },
    { label: "I'm cooking extra", stewardText: "I'm cooking extra tonight and happy to share a plate" },
    { label: "I have tools to lend", stewardText: "I have household tools I can lend" },
  ],
  mobile: {
    defaultMeetLevel: "Close friend",
  },
};
