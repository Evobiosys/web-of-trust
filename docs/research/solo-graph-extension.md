# Solo mode / personal network graph — extension architecture (research, not a build plan)

Status: design-only, no code changes. Written against v0.1 as of D15 (`packages/protocol` frozen at
`v: "0.1"`, D14 additive extensions merged). Source: Jakob's use-case note (see task brief) +
`CLAUDE.md` I1–I9, `DECISIONS.md` D1–D15, `packages/agent-daemon/src/store/types.ts`,
`packages/agent-daemon/src/daemon/listings.ts`, `packages/agent-daemon/src/daemon/daemon.ts`,
`packages/protocol/src/schemas.ts`, `packages/protocol/src/policy.ts`, `apps/mobile-ui/src/screens/you.js`
+ `web.js`, `packages/app-profiles/src/types.ts`.

---

## 0. Verdict up front

**One v0.1 seam is missing and should land tonight**, small and additive: a "connected-only" guard on
the second-brain relay trigger in `daemon.ts`. Everything else in this design can be layered on top of
v0.1 later without touching frozen protocol types. See §5 for the precise diff sketch.

---

## 1. Concept mapping

Jakob's core distinction — "I hold data ABOUT my contacts on MY device (they have no accounts)" — maps
onto two things v0.1 already has, plus one thing it doesn't.

**Already exists and is reusable as-is:**

- `TrustEdge` (`packages/protocol/src/schemas.ts:41-57`) = a *connected peer*: someone with their own
  agent, reachable via `TransportAdapter.send(peer, envelope)`, with `level` (`contact`/`friend`/`close`),
  `display`, `expires_at`. This is "met in ceremony" territory — a two-sided relationship.
- `Provenance` (`schemas.ts:81-91`) already distinguishes `self` (my own item) from `second_brain`
  (`owner: PeerId`, `noted_at`) — "I know Timo has an old PC." D1.6 built the entire two-hop consent
  chain (D13) around this: the noted owner gets consent-pinged *at first relay attempt*, not at note
  creation.

**Missing — the new entity:**

- **`Contact`**: a locally-modeled person who is *not* a peer. No transport address, no trust edge, no
  ceremony. Proposed shape (store-layer, alongside `ListingRecord`/`LoanRecord` in
  `packages/agent-daemon/src/store/types.ts`):

  ```ts
  export interface ContactRecord {
    contact_id: string;          // local:<uuid> — see §5 namespace note
    display_name: string;
    source: "manual" | "google_contacts" | "logseq" | "tana" | "note_tag";
    agreements?: string;         // free text, e.g. "OK to relay resource asks, not availability"
    preferred_channel?: { kind: "signal" | "whatsapp" | "email" | "phone" | "in_person"; value: string };
    peer_id?: string;            // upgrade path: set once this Contact is met in ceremony and becomes a TrustEdge
    created_at: string;
    updated_at: string;
  }
  ```

  `peer_id?` is the whole upgrade story: a `Contact` starts peer-less; the moment Jakob and that person
  do the ceremony (mockup's "twenty seconds, face to face" — `web.js:175`), the daemon writes a
  `TrustEdge` for the real peer id *and* sets `contact.peer_id` to point at it. The `Contact` row is
  never deleted — it's the durable local history/notes container; the `TrustEdge` is the live
  protocol-facing relationship. Nothing about this requires touching `TrustEdgeSchema` or `PeerIdSchema`.

- **Resource-about-contact = existing `Item` with `provenance: { kind: "second_brain", owner: <contact id or peer id> }`.**
  This is the part that needs naming plainly: **`Provenance.owner` is typed `PeerId` (`schemas.ts:86`),
  which is `z.string().min(1)` — no runtime distinction between "a matrix user id/DID for a connected
  peer" and "a local contact id."** Syntactically a `ContactRecord.contact_id` parses fine as a `PeerId`
  — zod won't reject it. Semantically it is not one: it has no transport address. §5 covers why this
  matters and what to do about it *now*.

- **Agreements + preferred channel** = plain fields on `Contact` (above), not on `Item` or `TrustEdge`.
  They're properties of the relationship/person, not of a specific resource or trust level. No existing
  type needs to grow for this.

- **Resource matching against locally-modeled-only contacts** ("match → I reach out manually via their
  preferred channel") is a *local-only* variant of the existing matcher chain
  (`packages/agent-daemon/src/matcher/`): run the same embeddings → LLM → keyword pipeline over
  `Item`s whose `provenance.owner` resolves to a `Contact` with no `peer_id`, surface the match in the
  UI as "you could ask X yourself," and stop — no envelope is ever sent, because there's no one to send
  it to. This is functionally identical to `evaluatePolicy`'s existing `private` branch: a match that
  never leaves the device.

## 2. Import pipeline design

All three sources normalize into `ContactRecord` before touching the store. None of this needs a daemon
API change — it's new ingestion code that ends by calling the same `store.putContact()` a manual "add
contact" UI action would call.

- **Google Contacts**: People API OAuth *or* offline vCard (`.vcf`) export — vCard preferred for v1
  (no OAuth consent screen, no ongoing API credential to manage, matches "local sovereignty" framing).
  Parse `FN`/`TEL`/`EMAIL` → `display_name`/`preferred_channel` candidates; `source: "google_contacts"`.
- **Logseq/Markdown**: walk pages for blocks tagged `#person` (Jakob's own note-taker convention).
  Each `#person` block's page-title or first line → `display_name`; page body → seed text for the LLM
  enrichment pass (§below); `source: "logseq"`.
- **Tana**: JSON export (Tana's native export format, not the live API — this repo already has a
  `tana-local` MCP integration pattern to reference for field/tag shape, but the import itself should
  be file-based/offline like the others, not a live workspace dependency). Nodes tagged `#person` (or
  whatever supertag Jakob uses) → same normalization; `source: "tana"`.
- **Manual curation**: a UI form (or steward chat, reusing the existing confirm-before-save pattern —
  see below) that writes a `ContactRecord` directly.

**Dedup**: all four paths funnel through one normalizer keyed on (fuzzy name match + any shared
`preferred_channel.value`) before insert, so re-importing Google Contacts after a Logseq import doesn't
fork the same person into two `Contact` rows. This dedup step is new product logic, not an architectural
seam — nothing in v0.1 needs to change to support it.

**LLM enrichment pass** (ollama, local-only — I1): for each `Contact`, run the *existing* extraction
pattern already proven in `packages/agent-daemon/src/steward/steward.ts` (`extractCaptureProposal` →
`PendingCaptureRecord`, confirm-before-save) over accumulated notes/docs mentioning that contact, but
propose `Item`s with `provenance: { kind: "second_brain", owner: contact.contact_id }` instead of
`{ kind: "self" }`. The proposal carries a confidence score (new field on the *proposal*, not on `Item`
— confidence doesn't belong on the committed record) and surfaces in the same "reply yes to confirm"
steward flow `you.js`/mobile UI already has. This is a straight reuse of `PendingCaptureRecord`
(`store/types.ts:73-78`) — no schema change, just a new caller.

## 3. Two-device sensitivity tiers

Model the portable laptop as **a second daemon instance belonging to the same user, with its own device
key/peer id**, not as a special "trusted device" concept bolted onto `TrustEdge`. Concretely:

- Phone and laptop each run `agent-daemon` with their own persona config and their own DID/device
  identity (D12's OpenVTC direction already assumes a device-level identity per agent instance — this
  is the same primitive, just two instances under one human).
- A `TrustEdge` between the two devices' peer ids, `level: "close"` — but tagged (new, additive field)
  `self_device: true` so UI can tell "this is literally me on another machine" apart from a `close`
  human relationship. This is the one place a schema *addition* (not a v0.1 seam-break, an additive
  optional field) would land — but not tonight; it's pure solo-mode surface, orthogonal to anything v0.1
  ships without it.
- **Sensitivity tiers on nodes**: reuse `ListingTier`'s value space (`private`/`close`/`trusted`/
  `wot_commons`/`public`, D14) as the sensitivity dial on `Contact` and `Item` rows that only exist on
  the laptop — "extended graph" data simply never gets a policy wide enough to sync to the phone. No new
  enum needed; D14 already built this ladder generically enough to reuse.
- **Deferral flow** ("let me get back to you when I'm at my laptop"): an async message from phone-agent
  to laptop-agent over the *existing* transport (`TransportAdapter.send`), shaped like today's `DM`
  envelope (D14) but between the user's own two device peer ids rather than two humans. Laptop-agent
  processes it (matcher, LLM enrichment, whatever) and DMs the answer back whenever it's next online —
  this is exactly the async, no-guaranteed-delivery model `MockTransport`/`MatrixTransport` already
  assume (I5 swappability already covers "transport is unreliable, retry/queue is the adapter's job").

**What this needs from v0.1: nothing.** Two daemon instances, two device identities, a trust edge
between them, and the DM envelope are all compositions of primitives that already exist and are already
frozen at v0.1. The only genuinely new things (`self_device` flag, sensitivity tier reuse) are additive
and can land whenever solo-mode is actually built.

## 4. Dual Web2/Web3 view

Maps directly onto the existing skin system in `packages/app-profiles/src/types.ts` — no new mechanism
needed, one new knob on `MobileSkin`:

- `AppProfile.hidden: Array<"inventory" | "notes" | "trust" | "audit">` already hides panes per skin.
  Web2-simple view = current default (DIDs, VRCs, raw trust-edge state, audit log all hidden or
  simplified — the mockup's existing "connected/pending" shield labels and no-scores rule from D11
  already point this direction).
- Add one `MobileSkin` field (additive, optional, matches the existing pattern at
  `packages/app-profiles/src/types.ts:25-36`): `advancedToggle?: boolean` — when true, the UI renders
  Binance-style simple/pro switch that flips `hidden` membership for `trust`/`audit` at runtime instead
  of it being fixed per-profile. This is a UI-only, client-side change (D10's "profiles are client-side
  skins, daemon defaults stay conservative" already establishes this boundary) — the daemon never learns
  which view mode the human is in, so I9's server-side conservative defaults are untouched regardless of
  which view is showing.
- Pro/Web3 view surfaces raw `PeerId` (matrix id today, DID later per D12), `TrustEdge.level`, VRC-shaped
  credential detail, and the audit log (`AuditRecord`, `store/types.ts:181-188` — note `redact_for_asker`
  already exists precisely because different viewers need different detail levels; the same field could
  gate advanced-view detail on the *owner's own* client, though today it only gates asker-facing
  redaction — worth flagging as a design question rather than assuming reuse, see §6).

## 5. SEAM CHECK — the urgent part

**Finding: one seam, real, and cheap to close tonight.**

`Provenance.owner` (`packages/protocol/src/schemas.ts:86`) is typed `PeerId` = `z.string().min(1)`
(`schemas.ts:17`) — a bare string, no namespace tag distinguishing "connected peer with a transport
address" from any other string. That alone is not the break — zod being permissive here is fine and
arguably correct (v0 comment on `PeerIdSchema` already says "v0: matrix user id... later: DID," i.e. it
already expects to hold more than one identity scheme over time).

**The break is behavioral, in `packages/agent-daemon/src/daemon/daemon.ts`:**

- Line 355: `const kind: IncomingKind = matched.item.provenance.kind === "second_brain" ? "relay" : "direct";`
  — *any* second-brain item unconditionally becomes relay-eligible the moment it matches an incoming
  request. There is no check that `provenance.owner` is a reachable peer.
- Lines 512–539 (`forwardRelay`): reads `item.provenance.owner` as `notedOwner` and calls
  `await this.transport.send(notedOwner, requestEnvelope(...))` directly — **no trust-edge lookup, no
  "connected-only" guard.** Compare this to the pattern D14 *did* establish for exactly this class of
  risk: `sendDm` (`daemon/listings.ts:392-397`) and `receiveDm`/`receiveLoan`
  (`listings.ts:360-364, 400-403`) all check `store.getTrustEdge(peer)` before sending or accepting,
  explicitly commented "connected-only, defense in depth." `forwardRelay` predates D14 (it's D13, Task 1)
  and never got this guard.

For a Jakob-style local-only `Contact` — no peer id, no transport address, "they have no accounts" — an
LLM-enriched second-brain `Item` whose `provenance.owner` is a `Contact` id will hit this exact path the
first time it matches an incoming request from someone else, and `transport.send(notedOwner, ...)` will
either throw (id doesn't resolve to any known room/peer in the transport adapter) or, worse on a less
defensive future transport implementation, silently misroute. Either way it breaks the D1.6 promise that
"the noted person IS notified... before their having a resource is told to someone else" — the code
*assumes* it can always reach the noted owner to consent-ping them, and solo-mode's entire premise is
that it sometimes cannot.

This also has an I1/I8 angle worth stating plainly: right now nothing stops a second-brain item about a
never-connected local contact from being set to `audience: "trusted"`/`"wot_commons"` and entering the
match pipeline in the first place — `evaluatePolicy` (`packages/protocol/src/policy.ts`) only looks at
`item.policy`, never at `item.provenance`. That's fine today because every second-brain item in v0.1's
world necessarily has a connected owner (there's no other way to create one yet); it stops being fine
the moment `Contact` ships.

**Fix to land tonight** (small, additive, does not touch frozen protocol types — only daemon behavior):

In `daemon.ts`, before line 355, add a connected-owner check and route unreachable-owner second-brain
matches to the same "no eligible item" / PASS path used when nothing matches at all:

```ts
// before: const kind: IncomingKind = matched.item.provenance.kind === "second_brain" ? "relay" : "direct";
const isSecondBrain = matched.item.provenance.kind === "second_brain";
const ownerReachable = isSecondBrain
  ? this.store.getTrustEdge(matched.item.provenance.owner) !== undefined
  : true;
if (isSecondBrain && !ownerReachable) {
  // Noted owner isn't a connected peer (e.g. a local-only contact) — cannot
  // consent-ping them (I8), so this item is not eligible for relay. Treat as
  // no match, same PASS path as line 344-351.
  logOwner(this.store, this.clock, requestId, "no_match", "Matched item's noted owner is not a connected peer; cannot relay (I8).");
  this.scheduler.scheduleAt(dispatchAt, async () => {
    await this.transport.send(from, statusEnvelope(requestId, this.clock.now(), "PASS"));
    this.notifyChange();
  });
  this.notifyChange();
  return;
}
const kind: IncomingKind = isSecondBrain ? "relay" : "direct";
```

This is exactly the D14 "connected-only, defense in depth" pattern, applied to the one D13 code path
that didn't get it. It changes zero existing behavior for v0.1 (every existing fixture's second-brain
owner already has a trust edge, per D13's Anna/Ben/Timo scenario) and needs no schema change —
`PeerIdSchema`'s permissiveness is not the bug; the missing runtime check is.

**No other v0.1 seam found.** Specifically checked and cleared:
- `ItemSchema`, `TrustEdgeSchema` are `.strict()` zod objects — adding new *optional* fields later
  (`Contact`-related, `self_device`, etc.) is additive and safe; `.strict()` only rejects *unknown* keys
  on parse, it doesn't prevent the schema itself from growing.
- `AskPeerRecord.peer`, `IncomingRecord.requester_peer`, `RelayLinkRecord.noted_owner` are all bare
  `string`/`PeerId` too, but none of them are reachable from `Contact`-typed data in v0.1 — only
  `Provenance.owner` is, because it's the one field D1.6 designed specifically to hold "someone who
  isn't necessarily a live participant in this request."
- `app-profiles` skin system needs no v0.1 change for §4 — additive `MobileSkin` field only, whenever
  built.

## 6. ❗ Decision points for Jakob

- ❗ **Land the `forwardRelay` connected-only guard (§5) tonight, or accept the risk and defer to
  solo-mode's own build?** Recommended: land it tonight — it's ~10 lines, matches an existing pattern
  (D14), and closes a real (if not yet triggered) I1/I8 gap even before `Contact` exists, since nothing
  today actually stops a malformed/hand-edited `provenance.owner` from pointing at a non-peer string.
- ❗ **Contact id namespace convention** (`local:<uuid>` vs. some other prefix) — not urgent to decide
  tonight since `PeerIdSchema` is permissive either way, but should be fixed before any import pipeline
  code (§2) starts minting ids, so contact ids and future DIDs are visually/programmatically
  distinguishable in logs and audit entries (I6 auditability).
- ❗ **vCard export vs. Google People API OAuth** for the Contacts import (§2) — vCard keeps the whole
  pipeline offline/local-sovereignty-clean; OAuth is more "live sync" but adds a credential surface.
  Recommend vCard for v1, OAuth as a later opt-in.
- ❗ **`redact_for_asker` reuse for the Web2/Web3 advanced-view gate** (§4) — currently that field only
  governs asker-facing redaction of the *audit log*; reusing it (or its pattern) for the owner's own
  advanced-view detail is a plausible but unconfirmed reuse. Worth a short design pass when §4 is
  actually built, not tonight.
- ❗ **Self-device trust edges** (`self_device: true`, §3) — confirm this should be a real `TrustEdge`
  row (so existing policy/matcher code treats deferral-to-laptop uniformly with any other `close`
  relationship) rather than a separate mechanism. Recommended default: yes, reuse `TrustEdge`, tag it.

---

File: `docs/research/solo-graph-extension.md` (this file). Untracked — not committed.
