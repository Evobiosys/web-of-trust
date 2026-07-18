# FUTURE.md — temptations deliberately not built (§12)

- Chat-platform bridges (WhatsApp/Signal/Telegram)
- Real NFC / QR onboarding beyond [S2]
- Reputation scores, token economics
- Multi-hop beyond one relay
- Mobile packaging
- Real ZK circuits (v1 target — Markus owns crypto review, DECISIONS.md D1.3/D2)
- Federation with OpenVTC networks
- Exclusion cascade as *group* governance — per Jakob (D1.5) exclusion stays individual: I downgrade a peer in my own trust graph, no appeals, no notification. Protocol only records `vouched_by` to keep collective mechanisms possible later.

- Per-item SharePolicy editor driven by AppProfile.defaultPolicy (profiles are display-only today; D10).
- WhatsApp/Signal bridge onboarding: user chats in a bridged WhatsApp group with their private agent (no app install; Tana 2026-07-17). Requires Matrix path + bridge configs on matrix.myceli.al. Steward already speaks message-events.
- NFC handshake (Anton: QR "cannot just be pointed at"); web alpha ships QR + manual code.
- holons.io-style dashboard beyond the Web-rings tab (reference/holons).
- Second-degree borrow via via-chain (alpha: direct-connection borrow only; relay/ask flow covers FoaF discovery).
- In-app offer/gathering composer — v0.1 creates listings via REST/steward text only; a first-class compose-and-preview UI (with the per-item policy/tier picker above) is deferred (D17 stub).
- `TRANSPORT=matrix` wiring into `agent-daemon/src/main.ts` + WhatsApp/Signal bridge onboarding on matrix.myceli.al — the transport and Synapse profile exist in-tree but the factory throws on `matrix` today (D17 stub, D12 vision).
- Persist signed VRC trust credentials — v0.1 issues them on-demand at `/api/trust` export, not stored (D17 stub).

## Next-phase research tracks (decision inputs — `docs/research/*.md`, untracked, NOT shipping docs)

Three alignment/architecture notes were written ahead of v0.1's next phase. They are decision inputs for Jakob, each ending in an explicit ❗ decision block — surfaced here so the calls do not get lost:

- **`docs/research/ad4m-fit.md`** — does AD4M (coasys/ad4m) fit, and is a non-Holochain path real. ❗ Jakob to decide: (1) is any AD4M/Flux interop actually wanted or just intellectual alignment (lean: keep as reference / backlog only); (2) if a graph export is greenlit, is it post-consent-data-only (lean: yes — anything else needs a Markus privacy review); (3) does OpenVTC (D12) have a formal relationship to AD4M's VC-shaped credentials or is the resemblance convergent (lean: ask Jakob directly). ⚠️ note: the non-Holochain Link-Language ecosystem it relies on is suspiciously fresh (many repos pushed in one 2-day window) — treat "production-ready" claims as unverified.
- **`docs/research/storage-kidur-semantic.md`** — make storage work "in the kidur.org core / semantic manner." ❗ Jakob to confirm the interpretation of "kidur core" (his own EvoBioSys project, tier-C self-published, confidence 0.7) before it drives design; the `Store` seam (I5) needs nothing today. Open ❗ design calls: per-field visibility (`policy.audience` is item-level today) and open vs. fixed node types (closed additive enum today vs. Tana-style user-defined supertags) — both protocol/policy-layer decisions, not storage-engine ones.
- **`docs/research/solo-graph-extension.md`** — hold data ABOUT contacts who have no accounts (local-only `Contact`, peer-less until an edge is minted). Its §5 `forwardRelay` connected-only guard already landed as D16. ❗ Jakob to decide the `Contact` id namespace convention (`local:<uuid>` vs. another prefix) — not urgent, but names the pre-seam D16 already assumes.
- **CONNECT abuse-hardening (D-QR4, Task 4).** The consent-gated inbound CONNECT ships one guard: at most one pending inbound connect card per requester DID (dedupe/refresh). Deferred deeper hardening — a per-origin cross-requester flood cap (an unknown-peer swarm each with a distinct DID still mints one card apiece), outbound-record dedupe on repeated `sendConnect` to the same origin, a short-circuit when a live edge to the requester already exists, and honouring the CONNECT body's `relay` routing hint on a real (non-in-memory) transport. None weakens an invariant; they narrow surface area for a spam/DoS actor and complete real-transport routing.
