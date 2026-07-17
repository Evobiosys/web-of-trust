# Agent-daemon ↔ Device-UI contract (v0.1, frozen by integrator at M1→M2 boundary)

The UI is a thin client of **its own agent only** (localhost REST + WS). It never talks Matrix.
Asker-facing surfaces obey **I2**: no per-peer identity, inventory, or per-peer response state pre-consent.

Base URL: `http://localhost:<AGENT_PORT>` (anna 4101, ben 4102, timo 4103). WS at `/ws`.

## REST

### GET /api/state → 200
```jsonc
{
  "persona": { "name": "Anna", "peer_id": "@anna-agent:wot.local", "accent": "warm" },
  "items": [ Item ],                       // full items incl. provenance + policy (owner's own view)
  "trust_edges": [ TrustEdge ],
  "asks": [ {                              // requests I sent (asker side — SANITIZED, I2)
    "request_id": "…", "text": "…", "created_at": iso,
    "state": "open" | "waiting" | "someone_can_help" | "no_one_this_time" | "room_open" | "withdrawn",
    "queried_count": 1,                    // aggregate only — never which peers, never per-peer state
    "room_id": "…?"                        // only post-consent
  } ],
  "consent_cards": [ {                     // requests others sent me (owner side — full context, I4)
    "card_id": "…", "request_id": "…",
    "requester": { "peer_id": "…", "display": "Anna" },
    "text": "Hat wer einen Akkuschrauber?",
    "matched_item": Item,
    "kind": "direct" | "relay",            // relay = second_brain match, consent to forward (I8)
    "state": "pending" | "consented" | "declined" | "inactive",   // inactive after WITHDRAWN
    "created_at": iso
  } ],
  "rooms": [ { "room_id": "…", "peers": [{peer_id, display}], "messages": [{from, text, ts}], "context": "…" } ],
  "steward_log": [ { "role": "user" | "agent", "text": "…", "ts": iso } ]
}
```

### POST /api/steward `{ "text": string }` → `{ "reply": string }`
Natural-language entry point. The daemon classifies intent:
- inventory capture ("I have a Bosch cordless screwdriver…") → replies with a structured proposal and stores it **only after** a confirming follow-up ("yes"/"ja") — confirm-before-save;
- ask ("Hat wer …?") → fans out REQUEST, replies "Asked N trusted people nearby. You'll hear back.";
- anything else → helpful steward reply.
State changes also arrive via WS.

### POST /api/consent `{ "card_id": string, "conditions"?: string }` → `{ "ok": true }`
### POST /api/decline `{ "card_id": string }` → `{ "ok": true }`   (wire-indistinguishable from no-match, I3)
### POST /api/withdraw `{ "request_id": string, "reason"?: "fulfilled" | "cancelled" }` → `{ "ok": true }`
### POST /api/rooms/:room_id/message `{ "text": string }` → `{ "ok": true }`
### GET /api/audit → `{ "entries": [ { ts, decision, detail } ] }`  (human-readable, I6)

Errors: 4xx `{ "error": string }`. All endpoints bind 127.0.0.1 only.

## WS `/ws`
Server → client JSON events, each `{ "type": …, …payload }`:
`state_changed` (no payload — client refetches /api/state) · `steward_reply { text }` · `consent_card { card_id }` · `ask_update { request_id, state }` · `room_message { room_id, from, text, ts }`.
`state_changed` is the only event the UI strictly needs; the rest are hints.

## Daemon config (per persona)
Env: `PERSONA_NAME`, `PEER_ID`, `AGENT_PORT`, `DB_PATH`, `TRUSTED_PEERS_PATH`, `FIXTURES_PATH?`,
`MATRIX_HOMESERVER_URL`, `MATRIX_ACCESS_TOKEN` or (`MATRIX_REGISTRATION_SECRET` + auto-provision),
`OLLAMA_URL`, `CHAT_MODEL`, `EMBED_MODEL`, `STATUS_DELAY_MS` (default 30000 — uniform, no jitter, I3),
`TRANSPORT` = `matrix` | `mock`.
