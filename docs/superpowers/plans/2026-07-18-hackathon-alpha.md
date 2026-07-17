# Hackathon Alpha Implementation Plan — chat-first UX + relay + app skins + LAN alpha

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** By tomorrow evening, Jakob and hackathon friends can alpha-test on their own devices (phones/laptops on one LAN): a chat-first UX (ported from Zach's synchrolabs reference in `Code/ecstatic-world`), passive resource sharing with one-degree-removed relay, and multiple app skins (ecstatic-world, housing, family, business) over the same daemon.

**Architecture:** The existing agent-daemon REST/WS API (docs/API.md) stays the single backend surface (DECISIONS.md D9). The device UI front is rebuilt chat-first following the synchrolabs interaction pattern; an app-profile config layer supplies skin/copy/trust-defaults per app. Backend gains the two-hop relay consent chain ([S5], I8) and alpha-enablement endpoints (trust management, CORS, LAN bind). A single-process alpha server hosts N in-memory-connected daemons so the demo cannot die on Matrix/network problems; Matrix transport stays intact as the multi-host path.

**Tech Stack:** TypeScript end-to-end, pnpm workspaces, node:http + ws (daemon), React 19 + Vite + Tailwind 4 (UI, plus new dep `motion`), zod (protocol), node:test (daemon/protocol), vitest (UI), podman (containers).

## Global Constraints

- Invariants I1–I9 of `CLAUDE.md` bind every task. Most load-bearing here: **I2** (asker-facing UI/API: never per-peer identity/inventory/response state pre-consent), **I3** (declined vs no-match byte-identical `PASS`, uniform schedule), **I8** (relays use the same consent chain; every hop consents; noted person pinged at first relay, never at note creation; consent reply can carry `conditions` — D1.6), **I9** (defaults: `ask_each_time`, `audience: "trusted"`, `expires_at` +1y).
- UI talks ONLY to its own agent's REST/WS (docs/API.md). It never talks Matrix or other agents.
- Envelope stays `v: "0.1"`. Relay is composition of existing message types (fresh REQUEST per hop, §6.1 of the handover) — **no new envelope types**.
- Package filters: `@resource-web/protocol`, `@resource-web/transport`, `@resource-web/agent-daemon`, `@resource-web/device-ui`, `@resource-web/dashboard`.
- Test commands: daemon/protocol `pnpm --filter <pkg> test` (node:test); UI `pnpm --filter @resource-web/device-ui test` (vitest). Typecheck: `pnpm -r typecheck` (or `pnpm --filter <pkg> exec tsc --noEmit`).
- Container runtime is **podman**, not docker (`DOCKER ?= podman`, D3). Node is v26.
- UX source of truth: `../ecstatic-world/synchrolabs-reference/temp-synchrolabs-chat-main/` (read `src/app/page.tsx`, `src/components/prompt-kit/*`, `src/messages/en.json`). Port the **pattern** into the existing Vite app; do NOT adopt Next.js.
- Decisions → append to `DECISIONS.md`. Temptations → `FUTURE.md`. Never claim more privacy than implemented (I7).
- Commits: small, conventional prefixes (`feat:`, `fix:`, `docs:`), per-task branch merged by the integrator.
- The daemon package keeps deps lean (node:http, ws — no express).

---

### Task 0 (integrator, main thread): merge `m2-agent` into `main`, open `alpha` branch

Not dispatched — merge + verification only. `git merge m2-agent`, run `pnpm -r test` + `pnpm -r typecheck`, tag `m2`, create branch `alpha` off main. All subsequent tasks branch from/commit onto `alpha`.

---

### Task 1: Relay two-hop consent chain (backend [S5], I8)

**Files:**
- Modify: `packages/agent-daemon/src/daemon/daemon.ts`
- Modify: `packages/agent-daemon/src/store/types.ts`
- Modify: `packages/agent-daemon/src/api/types.ts` (only if a state string needs widening)
- Test: `packages/agent-daemon/src/daemon/daemon.test.ts` (extend; use existing `test_harness.ts` — it wires N daemons over the in-memory transport)

**Current state:** an incoming REQUEST matching a `second_brain` item already produces a consent card with `kind: "relay"` (daemon.ts:336). But `consent()` then treats it like a direct card: it opens a room between *me* (the note-holder) and the requester, and never contacts the actual owner. That violates I8's "every hop consents."

**Required behavior (three personas: Ben asks; Anna holds note "Timo has a 3m ladder"; Timo owns it):**
1. Ben's REQUEST reaches Anna. Anna's matcher hits her `second_brain` item (provenance `{ kind: "second_brain", owner: "@timo-agent:…" }`) → relay consent card for Anna (exists today). Anna's uniform STATUS schedule is unchanged (I3): PENDING while her card is pending.
2. Anna consents (this is her *relay* consent, optionally with conditions) → her daemon does NOT open a room. Instead it sends a **fresh REQUEST** to the noted owner (Timo) carrying the original request text, and records a pending relay linking `{ upstream_request_id, upstream_requester, downstream_request_id, noted_owner }`.
3. Timo's daemon treats that REQUEST like any direct one (match against his real inventory → consent card, kind `direct`, requester shown = Anna, the introducer — Timo may not know Ben; I8: no hop reveals more than a direct request).
4. Timo consents → his daemon replies CONSENT + creates the room + INTRO **to Anna** (his requester). Anna's daemon detects the CONSENT/INTRO belongs to a pending relay and (a) forwards CONSENT upstream to Ben, (b) invites/bridges: create the final room via her transport `createSharedRoom([ben, timo, anna])` with context "introduced by Anna", send INTRO to Ben and Timo. (Simplification allowed: reuse Timo's room only if transport supports invites — it doesn't; so Anna creates the 3-party room. Log the decision.)
5. If Timo declines or has nothing: Anna's downstream ask resolves `no_one_this_time` → Anna's daemon sends the uniform PASS upstream (already-scheduled STATUS logic must see the relay as unresolved until downstream resolves — extend the owner-status dispatch so a consented *relay* card stays PENDING upstream until downstream CONSENT/PASS).
6. Ben's view at every point: aggregate only ("someone can help" / "no one this time"). Never Anna's or Timo's identity pre-consent (I2). After both hops consent: room with both.
7. Auto-forward (`policy.mode === "auto_forward"` on the second-brain item) fires step 2 without a card (path exists for direct; extend to relay).

**Interfaces:**
- Produces: `RelayLink` store record `{ upstream_request_id: string; upstream_requester: PeerId; downstream_request_id: string; noted_owner: PeerId; state: "awaiting_downstream" | "resolved" | "failed" }` in `store/types.ts`; daemon handles it internally — no REST API change. Consent-card shape in `/api/state` unchanged (kind `"relay"` already exists).
- Consumes: `test_harness.ts` multi-daemon wiring; `envelopes.ts` constructors.

**Steps (TDD):**
- [ ] Failing test: three-daemon harness — Ben asks "ladder"; Anna holds second_brain note (owner=Timo); assert Anna gets relay card; Anna consents; assert Timo gets a direct card naming Anna as requester; Timo consents; assert Ben's ask state becomes `room_open` with a room containing Timo and Anna; assert Ben's `/api/state`-shaped snapshot never contained Anna/Timo identity before both consents (grep the sanitized snapshots at each stage).
- [ ] Failing test: decline branch — Timo declines; assert Ben ends `no_one_this_time`; assert wire messages Ben receives are byte-identical to a no-match run (reuse the existing I3 test pattern in daemon.test.ts).
- [ ] Failing test: auto_forward on the second-brain item skips Anna's card but still requires Timo's consent.
- [ ] Implement in daemon.ts: branch in `consent()` on `card.kind === "relay"`; new `RelayLink` store table (follow existing store patterns in `sqlite_store.ts` / `store.ts`); CONSENT/INTRO/STATUS handlers check relay links; upstream STATUS forwarding respects the uniform scheduler.
- [ ] All daemon tests green: `pnpm --filter @resource-web/agent-daemon test`. Typecheck green. Commit `feat(daemon): two-hop relay consent chain [S5, I8]`.

---

### Task 2: Alpha-enablement API — trust management, CORS, configurable bind

**Files:**
- Modify: `packages/agent-daemon/src/api/server.ts`
- Modify: `packages/agent-daemon/src/daemon/daemon.ts` (trust add/remove + second-brain note methods)
- Modify: `packages/agent-daemon/src/config.ts` (`API_HOST` env, default `127.0.0.1`)
- Modify: `docs/API.md` (document new endpoints + host binding + CORS)
- Test: `packages/agent-daemon/src/api/server.test.ts` (or colocated existing API tests)

**New endpoints:**
```
POST /api/trust        { peer_id, display }            → { ok: true }   // adds TrustEdge, default expires_at +1y (I9)
DELETE /api/trust      { peer_id }                     → { ok: true }   // individual-scale removal (D1.5)
POST /api/notes        { owner_peer_id, text }         → { ok: true }   // second-brain note: creates Item with provenance
                                                                        // { kind: "second_brain", owner, noted_at }, labels
                                                                        // parsed from text via existing steward capture path;
                                                                        // NO notification to owner (D1.6)
```
- CORS on every response: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: content-type`, `Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS`; answer `OPTIONS` preflight with 204. (Phones on the LAN hit `http://<laptop-ip>:<ui-port>` and the API cross-origin.)
- `startServer(daemon, port, host = process.env.API_HOST ?? "127.0.0.1")` — LAN exposure is opt-in via env; ⚠️ no auth on these endpoints — ALPHA.md (Task 5) must state this plainly.

**Steps (TDD):** failing tests for each endpoint (add trust edge then GET /api/state shows it; delete removes; POST /api/notes creates a provenance-correct item; OPTIONS preflight 204 + CORS headers on GET) → implement → green → update docs/API.md → commit `feat(daemon): trust + second-brain endpoints, CORS, configurable bind host`.

---

### Task 3: App-profile (skin) system in device-ui

**Files:**
- Create: `apps/device-ui/src/profiles/types.ts`, `apps/device-ui/src/profiles/ecstatic.ts`, `apps/device-ui/src/profiles/housing.ts`, `apps/device-ui/src/profiles/family.ts`, `apps/device-ui/src/profiles/business.ts`, `apps/device-ui/src/profiles/index.ts`
- Create: `apps/device-ui/src/runtime_config.ts`
- Test: `apps/device-ui/src/profiles/profiles.test.ts`, `apps/device-ui/src/runtime_config.test.ts`

**Profile type (exact):**
```ts
export interface SuggestionGroup { label: string; icon: "sparkles" | "home" | "users" | "user" | "hand-heart"; highlight: string; items: string[] }
export interface AppProfile {
  id: "ecstatic" | "housing" | "family" | "business";
  brandName: string;                  // header text, e.g. "Ecstatic World"
  heading: string;                    // centered landing heading
  subheading?: string;
  theme: { accent: string; bg: string; isDark: boolean };  // tailwind token strings
  suggestionGroups: SuggestionGroup[];
  defaultPolicy: { audience: "private" | "trusted" | "wot_commons"; mode: "ask_each_time" | "auto_forward" };
  hidden: Array<"inventory" | "notes" | "trust" | "audit">;  // panes hidden in this skin
  quickAdds: Array<{ label: string; stewardText: string }>;  // one-tap resource capture, sent to POST /api/steward
}
```
- **ecstatic**: dark theme (match Zach's `#111`/`#eee` walking skeleton + synchrolabs dark aesthetic), brandName "Ecstatic World", heading about the dance/community field, suggestionGroups around events/hosting/rides/floor-space, defaultPolicy `{ audience: "trusted", mode: "ask_each_time" }`, hidden: `["audit"]`.
- **housing**: light warm theme, brandName "Roof", heading "Wer hat ein Dach frei? / Who has a roof to share?", quickAdds like `{ label: "I can host 1–2 guests", stewardText: "I can host 1-2 guests in my apartment (couch/guest room), short stays" }`, suggestion items around "Wer kann mich nächstes Wochenende in Wien unterbringen?" etc., defaultPolicy `{ audience: "trusted", mode: "ask_each_time" }`, hidden: `["audit"]`.
- **family**: defaultPolicy `{ audience: "trusted", mode: "auto_forward" }` (close trust default), hidden: `["audit"]`.
- **business**: defaultPolicy `{ audience: "trusted", mode: "ask_each_time" }`, acquaintance framing in copy, hidden: `["notes", "audit"]`.
- `runtime_config.ts`: resolve `{ agentUrl, profileId, personaKey }` from URL query params `?agent=…&app=…&persona=…` → localStorage fallback → `VITE_*` env fallback → defaults. Export `getRuntimeConfig(): { agentUrl: string; profile: AppProfile; personaKey: string }`.
- `defaultPolicy` applies by sending it with steward-captured items — v0 wiring: the UI passes nothing; instead daemon default stays I9. For the alpha, apply the profile default client-side in copy only where the daemon default differs (family auto_forward): the UI shows a one-line "sharing default: ask each time / auto-forward" indicator sourced from the profile; actual per-item policy setting stays a FUTURE.md note. (Keeps I9 conservative defaults server-side; log this in DECISIONS.md.)

**Steps:** failing tests (each profile parses/validates; runtime config precedence: query > localStorage > env > default; unknown `app` falls back to `ecstatic`) → implement → green → commit `feat(ui): app-profile skin system (ecstatic, housing, family, business)`.

---

### Task 4: Chat-first shell — port Zach's synchrolabs UX pattern

**Files:**
- Read first (UX truth): `../ecstatic-world/synchrolabs-reference/temp-synchrolabs-chat-main/src/app/page.tsx`, `src/components/prompt-kit/{prompt-input,chat-container,message,prompt-suggestion,scroll-button}.tsx`, `src/messages/en.json`
- Create: `apps/device-ui/src/components/chat/ChatShell.tsx`, `PromptInput.tsx`, `SuggestionChips.tsx`, `MessageList.tsx`
- Modify: `apps/device-ui/src/App.tsx` (chat-first layout, profile-driven), `apps/device-ui/src/index.css` (theme tokens per profile), `apps/device-ui/package.json` (+`motion`)
- Test: `apps/device-ui/src/components/chat/ChatShell.test.tsx`; keep `i2-asker-blindness.test.tsx` green (it is the I2 gate)

**UX contract (from page.tsx, adapted):**
1. Landing state: centered `heading` (profile), prompt input below (rounded-3xl, shadow, textarea + circular ArrowUp submit), category chips under it (profile `suggestionGroups`: click category → its items as full-width suggestions + back button; click item → submits it as steward text).
2. First submit animates (via `motion`) into full-chat layout: header (brandName + connection status + persona), scrollable message list, input pinned bottom.
3. Message list renders the steward conversation (`state.steward_log`): agent messages plain/prose left, user messages right in muted bubble (max-w 75–85%). Ask-status updates (`asks[].state` transitions, e.g. "Asked 2 trusted people…", "Good news — someone can help") already arrive as steward_log/WS events from the daemon — render them as agent messages; do not synthesize per-peer detail (I2).
4. **Consent cards render inline in the chat stream** as actionable cards (requester display + request text + matched item + optional conditions input + Consent/Decline buttons — wire to existing `sendConsent`/`sendDecline`; `kind: "relay"` cards get a "you'd be connecting a friend" label). `state: "inactive"` cards show "request no longer active".
5. Post-INTRO rooms appear in the chat area: room messages interleave (from existing `rooms[]`), input routes to `POST /api/rooms/:id/message` when a room is selected (simple room switcher chip row above the input when rooms exist).
6. i18n-light: profile strings are the copy source; no i18n framework this sprint (log in FUTURE.md).
7. Persona accent (Anna warm / Ben cool) folds into profile theme; `getPersonaTheme` stays for the dashboard/demo path.

**Interfaces:** consumes `useAgentState(agentUrl)` as-is; consumes `getRuntimeConfig()` from Task 3. No new API calls beyond docs/API.md.

**Steps:** failing ChatShell tests (landing → chips visible from profile; submit → `sendSteward` called + layout switches; consent card renders + consent click calls handler; relay card labeled; I2 test still green) → implement (port pattern, restyle with Tailwind 4 tokens; `motion` for the landing→chat transition) → vitest + typecheck green → `pnpm --filter @resource-web/device-ui build` green → commit `feat(ui): chat-first shell (synchrolabs UX pattern, profile-driven)`.

---

### Task 5: "You" tab — inventory, notes, asks, trust — + housing quick-adds

**Files:**
- Create: `apps/device-ui/src/components/you/YouTab.tsx`, `TrustPane.tsx`, `NotesPane.tsx`, `QuickAdds.tsx`
- Modify: `apps/device-ui/src/App.tsx` (two-tab nav: **Chat | You**), reuse `InventoryPane.tsx` (+ provenance badge) inside YouTab
- Modify: `apps/device-ui/src/hooks/useAgentState.ts` (add `addTrust`, `removeTrust`, `addNote` calling Task 2 endpoints)
- Test: `apps/device-ui/src/components/you/YouTab.test.tsx`

**Content of You tab (per Jakob's "my things in 'you'"):**
- My inventory (existing pane; provenance badges self vs second-brain), respecting profile `hidden`.
- My asks list (status only, aggregate — I2) with Withdraw buttons (`sendWithdraw` exists? if not, add to hook calling `POST /api/withdraw`).
- Trust circle: list edges + add-friend form (peer_id + display → `addTrust`) + remove. Copy: "verified in person" framing.
- Second-brain notes: add-note form (owner dropdown from trust edges + free text → `addNote`); list = inventory items filtered `provenance.kind === "second_brain"`.
- Quick-adds (profile `quickAdds`): one-tap buttons → `sendSteward(stewardText)` then switch to Chat tab showing the confirm-before-save dialog the steward already does.

**Steps:** failing tests (tab nav renders; You tab hides panes per profile.hidden; add-friend calls POST /api/trust; quick-add sends steward text) → implement → green + typecheck + build → commit `feat(ui): You tab (inventory, trust circle, notes, asks) + profile quick-adds`.

---

### Task 6: Alpha server + LAN scripts + ALPHA.md

**Files:**
- Create: `scripts/alpha_server.ts` — one Node process, N daemons over the in-memory transport hub (reuse `test_harness.ts` wiring pattern from the daemon package, but with real `startServer` per persona on ports 4101…410N and `API_HOST=0.0.0.0`), personas from `alpha/personas.json`
- Create: `alpha/personas.json` (Jakob + placeholder friends: `[{ "key": "jakob", "name": "Jakob", "port": 4101 }, …]` — 6 entries, trust edges all-to-all by default for the hackathon circle)
- Create: `scripts/alpha_up.sh` — starts alpha_server + `pnpm --filter @resource-web/device-ui dev -- --host 0.0.0.0 --port 5173`, detects LAN IP (`ipconfig getifaddr en0` fallback `en1`), prints per-friend join URLs `http://<ip>:5173/?agent=http://<ip>:410N&app=<profile>&persona=<key>` (+ QR via `npx qrcode-terminal` if available, plain URLs otherwise); traps EXIT to kill both (no orphaned servers)
- Create: `ALPHA.md` — quickstart: prerequisites (same WiFi), how Jakob starts it, how each friend joins (open their URL, rename via persona), what to try (housing ask flow, relay demo, ecstatic skin), ⚠️ security box (no auth, LAN-open API, alpha only), Matrix path (`TRANSPORT=matrix` + homeserver) as the multi-host option, troubleshooting (LuLu firewall must allow inbound node/vite; phones must be on the same subnet)
- Modify: `package.json` root scripts: `"alpha": "bash scripts/alpha_up.sh"`

**Steps:** implement script (no TDD for shell; alpha_server gets one smoke test: boots 2 personas, `GET /api/state` on both ports OK, cross-persona ask reaches consent card) → run the smoke test → run `alpha_up.sh` on this machine, curl both ports from the LAN IP (not localhost) to prove binding, then kill (verify no listeners left: `lsof -nP -iTCP:4101-4110 -sTCP:LISTEN` empty) → commit `feat(alpha): single-host LAN alpha server, join URLs, ALPHA.md`.

---

### Task 7: End-to-end verification + docs closure

**Files:**
- Modify: `README.md` (alpha section link, skins list; Honesty Box untouched-or-extended, never weakened)
- Modify: `DECISIONS.md` (append: relay room simplification, profile client-side defaults, LAN/CORS tradeoff, anything discovered)
- Modify: `FUTURE.md` (i18n framework, per-item policy editor from profile default, Matrix bridges, keyring-wallet if skipped)
- Test: run full suite `pnpm -r test` + `pnpm -r typecheck` + `pnpm --filter @resource-web/device-ui build`

**Steps:** drive the real flow end-to-end via alpha server (steward capture → ask from second persona → consent → room message; relay: note → third persona ask → both consents → 3-party room) using curl/scripted client; capture the transcript into `verification/alpha-run.txt`; fix anything broken (systematic-debugging if needed); commit `docs: alpha handback (verification transcript, decisions, future)`.

---

### Task 8 [#opt — only if all above done and green]: keyring-wallet interop probe

Timeboxed 45 min. Fetch https://github.com/berkmancenter/keyring-wallet README/schema only. If its credential/keyring JSON shape can be emitted by a pure function over our `TrustEdge[]`: add `GET /api/trust/export?format=keyring` + one unit test + DECISIONS entry. If not trivially mappable: write findings + mapping sketch to `FUTURE.md`, done. **Sebra moderator hosting: out of scope tonight** (no moderator concept exists in either codebase; needs a design conversation — noted in FUTURE.md).

---

## Self-review notes

- Spec coverage: chat UX ✅ (T4), Matrix kept ✅ (untouched, tests must stay green — T0/T7 run full suite), passive-share backend ✅ (exists + T1 relay + T2 notes endpoint), one-degree-removed ✅ (T1), event org w/o centralization ✅ (ecstatic profile + P2P daemon architecture; no new event system — YAGNI for alpha), multi-app skins + trust defaults ✅ (T3), housing UI ✅ (T3+T5), local multi-device alpha ✅ (T6), shareable ✅ (ALPHA.md + join URLs), keyring-wallet optional ✅ (T8).
- Known simplifications logged where made: relay 3-party room created by introducer; profile trust-default client-side copy only (server keeps I9); no i18n framework.
- Type consistency: `AppProfile`/`getRuntimeConfig` (T3) consumed by T4/T5; Task 2 endpoints consumed by T5 hook; RelayLink internal to daemon.
