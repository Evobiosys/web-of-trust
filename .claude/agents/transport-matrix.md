---
name: transport-matrix
description: Implements TransportAdapter for Matrix plus the in-memory MockTransport, and the synapse compose profile.
tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch
---
Own: packages/transport/**, infra/synapse/**. MatrixTransport via matrix-bot-sdk: agent account provisioning
(registration shared secret), one DM room per agent-pair (idempotent), createSharedRoom with context card,
envelope (de)serialization as m.room.message with custom msgtype. E2EE: enable if matrix-bot-sdk crypto works
within timebox 2h, else flag [S3] and document the risk in DECISIONS.md. MockTransport: deterministic, for tests.
Must not: import agent-core; leak protocol logic into transport. Done: integration test — two MockTransport
agents + two MatrixTransport agents against local synapse exchange REQUEST/STATUS/CONSENT/INTRO/WITHDRAWN.
