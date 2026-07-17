device-ui — React device UI (Vite + React 19 + Tailwind v4)
=============================================================

One codebase, persona-configured via env vars:

  VITE_PERSONA     anna | ben | timo   (accent theme + fallback display name)
  VITE_AGENT_URL   base URL of this device's own agent daemon (REST + WS)

Commands
--------
  pnpm --filter @resource-web/device-ui dev:anna   # vite --port 5173, talks to :4101
  pnpm --filter @resource-web/device-ui dev:ben     # vite --port 5174, talks to :4102
  pnpm --filter @resource-web/device-ui build       # tsc --noEmit + vite build
  pnpm --filter @resource-web/device-ui typecheck
  pnpm --filter @resource-web/device-ui test        # vitest run

  pnpm --filter @resource-web/device-ui mock:anna   # mock/mock_server.mjs --persona=anna --port=4101 --scene=0
  pnpm --filter @resource-web/device-ui mock:ben    # mock/mock_server.mjs --persona=ben  --port=4102 --scene=0

Run a persona's dev server against its own mock agent, e.g. for Anna:
  node mock/mock_server.mjs --persona=anna --port=4101 --scene=4 &
  VITE_PERSONA=anna VITE_AGENT_URL=http://localhost:4101 pnpm dev --port 5173

The mock server (mock/mock_server.mjs) implements docs/API.md exactly
(REST + WS at /ws) against in-memory state seeded from a numbered scene
(mock/scenes.mjs) — the same fixtures the Vitest component/I2 tests import
directly. It is dev/test tooling only, not part of the shipped app bundle;
the real daemon (a sibling worktree) is integrated at merge.

Scene -> §2 demo-story step mapping
------------------------------------
The daemon (this repo) does not carry a separate numbered "§2 demo-story"
document in this worktree; the eight scenes below were derived from (a) the
"mock agent server" scene list in task-m3u-brief.md and (b) the seven-step
narrative + seed fixtures (Ben: Bosch IXO cordless screwdriver, 2p camping
tent, 3m ladder; Anna: bicycle pump; trust edge Anna<->Ben) specified in
task-m4-brief.md (owned by the demo-harness agent, read here for grounding
only). --scene=N selects the same index for whichever --persona you run.

  scene  label                      demo-story step(s)
  -----  -------------------------  --------------------------------------
  0      empty                      baseline before step 1 — every pane's
                                     empty state (steward log, inventory,
                                     consent cards, rooms all empty)
  1      inventory-captured         1. ben-captures-item — Ben's steward
                                     confirms "Bosch IXO cordless
                                     screwdriver" into his inventory
  2      ask-waiting                2/3. anna-asks / anna-waiting — Anna's
                                     steward sends "Hat wer in meiner Nähe
                                     einen Akkuschrauber?"; ask chip shows
                                     "Asked 1 trusted people nearby."
  3      consent-card-pending       4. ben-consent-card — Ben sees Anna's
                                     identity + request text + the matched
                                     screwdriver, Yes/No + conditions input
  4      good-news-room             5a. good-news-room — Ben said Yes;
                                     Anna's ask chip flips to the aggregate
                                     good-news ping and the shared room
                                     opens with one message each way
  5      declined-no-one            5b. decline-invisible AND 7.
                                     negative-control — Anna's view is
                                     identical either way (I3): "No one
                                     could help this time." Ben's own
                                     record locally shows "declined" for
                                     the 5b take (never leaked to Anna).
  6      withdrawn-inactive         6. withdrawn — Anna withdrew
                                     (fulfilled); her ask chip shows
                                     struck-through text; Ben's consent
                                     card flips to greyed "request no
                                     longer active"
  7      second-brain-provenance    extra coverage (not a numbered §2
                                     step): Ben's inventory includes the 3m
                                     ladder noted from Timo (provenance
                                     badge "noted: told by Timo") and a
                                     `relay`-kind consent card with the
                                     "forward a friend's note" hint (I8)

Ports
-----
  anna device UI   5173        anna mock agent   4101
  ben  device UI   5174        ben  mock agent   4102
  dashboard        8080 (apps/dashboard)

data-testid hooks
------------------
  steward-input, steward-send, steward-log, steward-log-empty
  ask-chips, ask-chip-<request_id>
  inventory-pane, inventory-empty, item-card-<id>, provenance-badge-<id>
  consent-cards-pane, consent-cards-empty, consent-card-<card_id>,
  consent-card-status-<card_id>, consent-card-relay-hint-<card_id>,
  consent-yes, consent-no, consent-conditions
  room-pane, room-pane-empty, room-messages, room-message-input, room-send
  app-loading, connection-status
