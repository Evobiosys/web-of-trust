// Shared fixture data for the mock agent server AND the Vitest component
// tests (imported directly — plain .mjs so Node runs it with no loader and
// Vitest imports it unmodified). One source of truth for both.
//
// Scene indices double as the §2 demo-story steps (see task-m4-brief.md /
// README.txt "scene -> step" table):
//   0 empty | 1 inventory-captured | 2 ask-waiting | 3 consent-card-pending
//   4 good-news+room | 5 declined/no-one | 6 withdrawn-inactive
//   7 second-brain item + provenance badge (relay consent card)

const ANNA_PEER = "@anna-agent:wot.local";
const BEN_PEER = "@ben-agent:wot.local";
const TIMO_PEER = "@timo-agent:wot.local";

const T0 = "2026-07-10T09:00:00.000Z";
const T1Y = "2027-07-10T09:00:00.000Z";

const personas = {
  anna: { name: "Anna", peer_id: ANNA_PEER, accent: "warm" },
  ben: { name: "Ben", peer_id: BEN_PEER, accent: "cool" },
  timo: { name: "Timo", peer_id: TIMO_PEER, accent: "neutral" },
};

const trustEdgesAnna = [
  { peer: BEN_PEER, display: "Ben", created_at: T0, expires_at: T1Y },
];

const trustEdgesBen = [
  { peer: ANNA_PEER, display: "Anna", created_at: T0, expires_at: T1Y },
];

const trustEdgesBenWithTimo = [
  ...trustEdgesBen,
  { peer: TIMO_PEER, display: "Timo", created_at: T0, expires_at: T1Y },
];

const screwdriver = {
  id: "item-screwdriver",
  labels: ["Bosch IXO cordless screwdriver"],
  description: "Bosch IXO cordless screwdriver, barely used.",
  tags: ["tools", "cordless"],
  provenance: { kind: "self" },
  policy: { audience: "trusted", mode: "ask_each_time", expires_at: T1Y },
  location_area: "Wien-Ottakring",
  availability: "evenings and weekends",
};

const tent = {
  id: "item-tent",
  labels: ["2p camping tent"],
  description: "Two-person camping tent, easy setup.",
  tags: ["outdoors", "camping"],
  provenance: { kind: "self" },
  policy: { audience: "trusted", mode: "ask_each_time", expires_at: T1Y },
  location_area: "Wien-Ottakring",
};

const ladderSecondBrain = {
  id: "item-ladder",
  labels: ["3m ladder"],
  description: "3m aluminium ladder — Timo has one, told Ben about it.",
  tags: ["tools", "household"],
  provenance: { kind: "second_brain", owner: TIMO_PEER, noted_at: T0 },
  policy: { audience: "trusted", mode: "ask_each_time", expires_at: T1Y },
  location_area: "Wien-Ottakring",
};

const bicyclePump = {
  id: "item-pump",
  labels: ["bicycle pump"],
  description: "Standard floor bicycle pump.",
  tags: ["bike"],
  provenance: { kind: "self" },
  policy: { audience: "trusted", mode: "ask_each_time", expires_at: T1Y },
  location_area: "Wien-Favoriten",
};

const REQUEST_ID = "req-akkuschrauber-001";
const CARD_ID = "card-anna-to-ben-001";
const ROOM_ID = "room-anna-ben-001";

function emptyState(personaKey) {
  return {
    persona: personas[personaKey],
    items: [],
    trust_edges: personaKey === "anna" ? trustEdgesAnna : trustEdgesBen,
    asks: [],
    consent_cards: [],
    rooms: [],
    steward_log: [],
  };
}

function captureLog() {
  return [
    { role: "user", text: "I have a Bosch cordless screwdriver I barely use.", ts: T0 },
    {
      role: "agent",
      text: 'Got it — "Bosch IXO cordless screwdriver", shared with trusted peers, ask-each-time. Save it? (yes/ja)',
      ts: T0,
    },
    { role: "user", text: "yes", ts: T0 },
    { role: "agent", text: "Saved to your inventory.", ts: T0 },
  ];
}

function askLog(extra = []) {
  return [
    { role: "user", text: "Hat wer in meiner Nähe einen Akkuschrauber?", ts: T0 },
    { role: "agent", text: "Asked 1 trusted people nearby. You'll hear back.", ts: T0 },
    ...extra,
  ];
}

// --- Anna (asker) scenes -----------------------------------------------

const annaScenes = [
  emptyState("anna"),
  // 1 inventory-captured: nothing changes on Anna's side (Ben captured locally, I1)
  emptyState("anna"),
  // 2 ask-waiting
  {
    persona: personas.anna,
    items: [bicyclePump],
    trust_edges: trustEdgesAnna,
    asks: [
      {
        request_id: REQUEST_ID,
        text: "Hat wer in meiner Nähe einen Akkuschrauber?",
        created_at: T0,
        state: "waiting",
        queried_count: 1,
      },
    ],
    consent_cards: [],
    rooms: [],
    steward_log: askLog(),
  },
  // 3 consent-card-pending: asker still only sees "waiting" (I2/I3 — owner's
  // pace never leaks to the asker)
  {
    persona: personas.anna,
    items: [bicyclePump],
    trust_edges: trustEdgesAnna,
    asks: [
      {
        request_id: REQUEST_ID,
        text: "Hat wer in meiner Nähe einen Akkuschrauber?",
        created_at: T0,
        state: "waiting",
        queried_count: 1,
      },
    ],
    consent_cards: [],
    rooms: [],
    steward_log: askLog(),
  },
  // 4 good-news+room
  {
    persona: personas.anna,
    items: [bicyclePump],
    trust_edges: trustEdgesAnna,
    asks: [
      {
        request_id: REQUEST_ID,
        text: "Hat wer in meiner Nähe einen Akkuschrauber?",
        created_at: T0,
        state: "room_open",
        queried_count: 1,
        room_id: ROOM_ID,
      },
    ],
    consent_cards: [],
    rooms: [
      {
        room_id: ROOM_ID,
        peers: [
          { peer_id: ANNA_PEER, display: "Anna" },
          { peer_id: BEN_PEER, display: "Ben" },
        ],
        messages: [
          { from: "Ben", text: "Hey! Happy to lend the screwdriver — back by Sunday, please.", ts: T0 },
          { from: "Anna", text: "Perfect, thank you! I'll swing by tomorrow evening.", ts: T0 },
        ],
        context: "Bosch IXO cordless screwdriver",
      },
    ],
    steward_log: askLog([{ role: "agent", text: "Good news — someone has one and said yes.", ts: T0 }]),
  },
  // 5 declined/no-one (asker side — byte-identical narrative for either cause, I3)
  {
    persona: personas.anna,
    items: [bicyclePump],
    trust_edges: trustEdgesAnna,
    asks: [
      {
        request_id: REQUEST_ID,
        text: "Hat wer in meiner Nähe einen Akkuschrauber?",
        created_at: T0,
        state: "no_one_this_time",
        queried_count: 1,
      },
    ],
    consent_cards: [],
    rooms: [],
    steward_log: askLog([{ role: "agent", text: "No one could help this time.", ts: T0 }]),
  },
  // 6 withdrawn-inactive (Anna's own ask, withdrawn by Anna herself — fulfilled elsewhere)
  {
    persona: personas.anna,
    items: [bicyclePump],
    trust_edges: trustEdgesAnna,
    asks: [
      {
        request_id: REQUEST_ID,
        text: "Hat wer in meiner Nähe einen Akkuschrauber?",
        created_at: T0,
        state: "withdrawn",
        queried_count: 1,
      },
    ],
    consent_cards: [],
    rooms: [],
    steward_log: askLog([{ role: "agent", text: "Good news — someone has one and said yes.", ts: T0 }]),
  },
  // 7 second-brain (not relevant to Anna's own view — mirrors scene 2)
  {
    persona: personas.anna,
    items: [bicyclePump],
    trust_edges: trustEdgesAnna,
    asks: [],
    consent_cards: [],
    rooms: [],
    steward_log: [],
  },
];

// --- Ben (owner) scenes --------------------------------------------------

const benScenes = [
  emptyState("ben"),
  // 1 inventory-captured
  {
    persona: personas.ben,
    items: [screwdriver],
    trust_edges: trustEdgesBen,
    asks: [],
    consent_cards: [],
    rooms: [],
    steward_log: captureLog(),
  },
  // 2 ask-waiting: Ben has the item, hasn't been notified of the request yet
  {
    persona: personas.ben,
    items: [screwdriver, tent],
    trust_edges: trustEdgesBen,
    asks: [],
    consent_cards: [],
    rooms: [],
    steward_log: captureLog(),
  },
  // 3 consent-card-pending
  {
    persona: personas.ben,
    items: [screwdriver, tent],
    trust_edges: trustEdgesBen,
    asks: [],
    consent_cards: [
      {
        card_id: CARD_ID,
        request_id: REQUEST_ID,
        requester: { peer_id: ANNA_PEER, display: "Anna" },
        text: "Hat wer in meiner Nähe einen Akkuschrauber?",
        matched_item: screwdriver,
        kind: "direct",
        state: "pending",
        created_at: T0,
      },
    ],
    rooms: [],
    steward_log: captureLog(),
  },
  // 4 good-news+room: Ben said Yes
  {
    persona: personas.ben,
    items: [screwdriver, tent],
    trust_edges: trustEdgesBen,
    asks: [],
    consent_cards: [
      {
        card_id: CARD_ID,
        request_id: REQUEST_ID,
        requester: { peer_id: ANNA_PEER, display: "Anna" },
        text: "Hat wer in meiner Nähe einen Akkuschrauber?",
        matched_item: screwdriver,
        kind: "direct",
        state: "consented",
        created_at: T0,
      },
    ],
    rooms: [
      {
        room_id: ROOM_ID,
        peers: [
          { peer_id: ANNA_PEER, display: "Anna" },
          { peer_id: BEN_PEER, display: "Ben" },
        ],
        messages: [
          { from: "Ben", text: "Hey! Happy to lend the screwdriver — back by Sunday, please.", ts: T0 },
          { from: "Anna", text: "Perfect, thank you! I'll swing by tomorrow evening.", ts: T0 },
        ],
        context: "Bosch IXO cordless screwdriver",
      },
    ],
    steward_log: captureLog(),
  },
  // 5 declined/no-one: Ben said No — indistinguishable from no-match to Anna (I3)
  {
    persona: personas.ben,
    items: [screwdriver, tent],
    trust_edges: trustEdgesBen,
    asks: [],
    consent_cards: [
      {
        card_id: CARD_ID,
        request_id: REQUEST_ID,
        requester: { peer_id: ANNA_PEER, display: "Anna" },
        text: "Hat wer in meiner Nähe einen Akkuschrauber?",
        matched_item: screwdriver,
        kind: "direct",
        state: "declined",
        created_at: T0,
      },
    ],
    rooms: [],
    steward_log: captureLog(),
  },
  // 6 withdrawn-inactive: Anna withdrew (fulfilled) — Ben's card flips inactive
  {
    persona: personas.ben,
    items: [screwdriver, tent],
    trust_edges: trustEdgesBen,
    asks: [],
    consent_cards: [
      {
        card_id: CARD_ID,
        request_id: REQUEST_ID,
        requester: { peer_id: ANNA_PEER, display: "Anna" },
        text: "Hat wer in meiner Nähe einen Akkuschrauber?",
        matched_item: screwdriver,
        kind: "direct",
        state: "inactive",
        created_at: T0,
      },
    ],
    rooms: [],
    steward_log: captureLog(),
  },
  // 7 second-brain item + provenance badge + relay consent card
  {
    persona: personas.ben,
    items: [screwdriver, tent, ladderSecondBrain],
    trust_edges: trustEdgesBenWithTimo,
    asks: [],
    consent_cards: [
      {
        card_id: "card-relay-001",
        request_id: "req-ladder-001",
        requester: { peer_id: ANNA_PEER, display: "Anna" },
        text: "Hat jemand eine 3m Leiter, die ich mir für ein Wochenende ausleihen könnte?",
        matched_item: ladderSecondBrain,
        kind: "relay",
        state: "pending",
        created_at: T0,
      },
    ],
    rooms: [],
    steward_log: captureLog(),
  },
];

const scenesByPersona = { anna: annaScenes, ben: benScenes };

export const SCENE_LABELS = [
  "empty",
  "inventory-captured",
  "ask-waiting",
  "consent-card-pending",
  "good-news-room",
  "declined-no-one",
  "withdrawn-inactive",
  "second-brain-provenance",
];

/** Returns a deep-cloned AgentState for the given persona + scene index, so
 * callers can mutate it in-memory (mock server) without corrupting fixtures
 * shared across test runs. */
export function getScene(personaKey, sceneIndex) {
  const scenes = scenesByPersona[personaKey] ?? scenesByPersona.ben;
  const index = Math.max(0, Math.min(sceneIndex, scenes.length - 1));
  return structuredClone(scenes[index]);
}

export function getPersona(personaKey) {
  return personas[personaKey] ?? { name: personaKey, peer_id: `@${personaKey}-agent:wot.local`, accent: "neutral" };
}
