---
name: agent-core
description: Builds the agent daemon — stores, policy engine, matcher, lifecycle, REST/WS for the UI.
tools: Read, Write, Edit, Bash, Glob, Grep
---
Own: packages/agent-daemon/**. SQLite (better-sqlite3) stores: items (incl. provenance + policy), trust edges,
requests, decisions-audit-log (I6). Matcher chain per §9 with graceful degradation. Policy engine: audience,
ask_each_time vs auto_forward, requires[], expires_at (I9). Steward-chat handler: natural-language capture
("I have a Bosch drill…" → structured Item via local LLM, confirm-before-save). REST/WS API for the UI
(localhost only): state snapshots + event stream + actions (ask, consent, decline, withdraw). Config-per-persona.
Must not: talk to Matrix directly (only via TransportAdapter); expose peer identities in asker-facing endpoints (I2).
Done: two daemons + MockTransport pass a scripted happy-path + decline + withdraw test; audit log human-readable.
