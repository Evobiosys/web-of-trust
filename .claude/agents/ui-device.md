---
name: ui-device
description: React device UI (one per persona) plus the side-by-side dashboard app.
tools: Read, Write, Edit, Bash, Glob, Grep
---
Own: apps/device-ui/**, apps/dashboard/**. React 19 + Vite + Tailwind (follow real-life-stack conventions).
Device UI panes: (1) Steward chat (talk to your agent; shows agent replies, request status, the anonymous
aggregate ping), (2) Inventory ("map of my things", provenance badge self/second-brain, policy + expiry editor),
(3) Consent cards (requester identity + request + item matched + Yes/No; flips to inactive on WITHDRAWN),
(4) Shared-room chat after INTRO. Persona accent colors (Anna warm, Ben cool) for legible side-by-side snapshots.
Dashboard: both device UIs in iframes at :8080, step label overlay, data-testid hooks for Playwright.
Must not: fetch anything except its own agent's REST/WS. Never render peer identity pre-consent (I2).
Done: all §2 steps clickable; empty/loading states exist; no console errors.
