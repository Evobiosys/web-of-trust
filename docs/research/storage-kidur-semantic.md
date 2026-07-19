# Storage architecture: kidur core manner + semantic-web global wiki — research (not a build plan)

Status: design-only, no code changes. Written against v0.1 (`packages/protocol` frozen at `v: "0.1"`,
D14 additive extensions merged). Question posed by Jakob: make the project's data storage work "in the
kidur core manner" (kidur.org) and support a "global wiki, semantic-web style" (Tana-like: nodes + typed
fields + supertags), as a **later** extension — v0.1 ships with its current SQLite store unchanged.

Sources read: `packages/agent-daemon/src/store/{types.ts,store.ts,sqlite_store.ts}`,
`packages/protocol/src/schemas.ts`, `CLAUDE.md` (I1–I9), `HANDOVER-resource-web-sprint.md` §3,
`docs/research/solo-graph-extension.md` (prior art, same status/pattern — not duplicated here).

---

## 0. Verdict up front

- **kidur.org is Jakob's own project** (EvoBioSys ecosystem), not a public standard — the "kidur core
  manner" is a vision to align with, not a spec to implement against. Confidence in what the page *says*:
  0.9 (fetched directly). Confidence that "storage architecture" is the right reading of "kidur core
  manner": 0.7 — ❗ flagged, see §1.
- **"Global wiki" must be reconciled with I1 (local sovereignty) / I2 (asker blindness) / I3
  (indistinguishable no) or the proposal contradicts the project's core.** The reconciliation: the "wiki"
  is never a shared store — it is the subset of each owner's local nodes that owner has explicitly set to
  `audience: "wot_commons"` or `"public"` via the *existing* `SharePolicyAudienceSchema` (D14). Nothing
  new is needed to define this boundary; it already exists. See §2.
- **Minimal-seam verdict: the `Store` interface (I5) needs nothing today.** The one open question is not
  at the store layer — it's whether v0.1's *policy* model (item-level `audience`) should eventually grow
  to field-level visibility. That is a protocol-layer design question for the extension, not a v0.1 gap.
  See §3.

---

## 1. What kidur.org actually is

Fetched `https://www.kidur.org/` directly (WebFetch, 2026-07-18). The page is a single-page vision/landing
page — no `/docs`, `/architecture`, `/about`, or `/whitepaper` subpage exists (all return 404); no linked
GitHub repo. It sits under the EvoBioSys ecosystem (references point to evobiosys.org), which is Jakob's
own umbrella project.

**What the page says, close to verbatim:**
- "A personal sovereign archive for quests, memory, and developmental trajectory."
- Name from Sumerian *ki* (place/base) + *dur* (bond/enclosure) — "a foundational structure that holds
  and binds."
- Privacy-first, infrastructure-agnostic: "your archive lives on your infrastructure, under your
  control"; "nothing reaches servers you haven't chosen."
- Chronological indexing (not app-based sorting), deduplication, and navigable indexing of digital
  artifacts — "the systems file and the voice memo and the whiteboard photo" treated as unified
  historical records.
- Tracks not just artifacts but "the arc: what you were becoming, the quests you carried, where you were
  heading" — developmental trajectory, not just storage.
- Designed to be "handed on — to family, collaborators, or institutions that carry forward what you
  couldn't finish" — longevity/transferability, explicit anti-obsolescence framing ("apps shut down,
  drives fail, formats rot").

**What the page does NOT say:** anything about database engines, schemas, triple stores, EAV models,
APIs, or sync protocols. There is no documented "storage architecture" to copy. Kidur is a *values*
statement (sovereignty, durability, chronological/developmental framing, portability to heirs), not a
technical spec.

**❗ Interpretation required (confidence 0.7, tier C — self-published, Jakob's own project):** "storage
architecture in the kidur core manner" most plausibly means *honor kidur's values in how the store is
built*, i.e.:
1. Data lives on the owner's own infrastructure, never a third-party server (kidur ↔ I1, already true).
2. The store should be able to hold and index *chronological, developmental* records, not only the
   current five domain types — this is a new dimension (see the `Event` node type in §2) that v0.1 has
   only a thin analog of (the append-only `audit_log`, I6).
3. Data should be exportable/transferable wholesale, not siloed by app — this is the JSON-LD export
   requirement in §2, and also argues for keeping the store engine swappable (already I5).

This reading is NOT confirmed by kidur.org itself, which never uses the words "database," "schema," or
"architecture." Jakob should confirm or correct this interpretation before it drives any design decision
beyond what's already implied by I1/I5/I6.

---

## 2. Target data model sketch

Two requirements, kept conceptually separate because they come from different sources and solve different
problems:

- **kidur** (§1) = an ethos: local sovereignty, durability, chronological/developmental framing. Mostly
  already satisfied by I1 (local sovereignty) and I6 (auditability, which is already append-only and
  chronological). The one net-new piece is a first-class `Event`/trajectory node type (below).
- **Tana-like semantic wiki** = a structural requirement: entity–attribute–value (EAV) nodes with typed
  fields and tags ("supertags"), queryable as collections, with a federated/shared subset visible across
  the web of trust.

### 2.1 Node model

Tana's model (confirmed via `tana.inc/docs/supertags`, `tana.inc/docs/fields`, search 2026-07-18, tier B):
every node is the same primitive; a **supertag** turns a node into a typed object ("is-a" relationship —
"buy milk" *is* a `#Task`, the tag doesn't just label it); a **field** is a typed, named attribute on a
tagged node ("has-a" relationship, like a database column); all nodes sharing a supertag form a
collection, filterable/viewable as a table. This maps cleanly onto RDF/JSON-LD semantics (W3C, tier A):
node ≈ subject, supertag ≈ `rdf:type`/`@type`, field ≈ predicate, field value ≈ object — a supertag'd node
with fields is one RDF entity's worth of triples, and JSON-LD is exactly "typed nodes with named
properties" serialized with `@context`/`@type`/`@id`.

Sketch for this project, generalizing the current five domain types (`Item`, `TrustEdge`, listing, loan,
DM thread) plus the new kidur-motivated one:

```
Node
├── id            (stable, this device's namespace)
├── type          (supertag: Person | Resource | Agreement | Event | ...)
├── fields{}      (typed, per-type: EAV bag — see §3 for why this is cheap)
├── tags[]        (free-form, cross-type labels — orthogonal to `type`)
├── provenance    (self | second_brain{owner, noted_at} — EXISTING, ProvenanceSchema)
├── policy        (audience | mode | requires | expires_at — EXISTING, SharePolicySchema)
└── created_at / updated_at
```

- **Person** ≈ today's `TrustEdge` (peer, display, level) generalized to also hold non-peer `Contact`s
  (see `docs/research/solo-graph-extension.md` — same node type, this doc's `Contact` proposal is a
  special case of `Person` with no transport address).
- **Resource** ≈ today's `Item` almost verbatim (`labels`, `description`, `tags`, `location_area`,
  `availability` are already field-shaped).
- **Agreement** ≈ today's `LoanRecord` generalized (loan is one `Agreement` subtype; a lending agreement,
  a favor, a co-op commitment could be others without a new table).
- **Event** ≈ **new**, motivated directly by kidur's "developmental trajectory" framing (§1): a
  chronological node type (what happened, when, which other nodes it touches) that the current
  `audit_log` (I6) is architecturally 80% of already — `AuditRecord` is append-only, timestamped,
  human-readable, and references request/decision context. Promoting audit entries (and steward-log
  entries, room messages, DM messages) to `Event` nodes with a `refs: NodeId[]` field is the natural kidur
  "chronological archive" layer, and costs nothing new at the store level (§3).

### 2.2 JSON-LD export mapping

Each node type maps to a `@type`; `id` → `@id`; `fields` → JSON-LD properties directly; `tags` → an
array-valued custom property (or `skos:related`-style, if aligning to a public vocabulary later). Example
for a `Resource` node built from today's `Item`:

```json
{
  "@context": { "@vocab": "https://schemas.resource-web.example/v1/" },
  "@type": "Resource",
  "@id": "item:9f2a...",
  "labels": ["Bosch IXO"],
  "description": "cordless screwdriver",
  "tags": ["tools", "diy"],
  "provenance": { "kind": "self" },
  "policy": { "audience": "trusted", "mode": "ask_each_time" },
  "locationArea": "Wien-Ottakring"
}
```

This is a pure read/export transform — `ItemSchema`/`TrustEdgeSchema`/etc. already zod-validate the exact
shape being serialized; no store change is implied. real-life-stack's own `resource` JSON-LD schema
(`docs/spec/schemas/` per HANDOVER-resource-web-sprint.md §3, tier B/C) is the natural vocabulary to align
`@context` with rather than inventing a parallel one, since Task 5 already targets compatibility with it.

### 2.3 "Global wiki" = consent-gated federated subset, not a shared store

This is the point that must be stated explicitly (flagged by review before writing this section): a
literal shared/replicated "global wiki" of everyone's nodes would violate I1 (inventory never leaves the
owner's device except local match results + post-consent detail) and I2 (asker blindness) outright. That
is **not** what's being proposed.

Instead: "global wiki" = each peer's own store, individually queryable/federated across the web of trust,
where **only** the nodes an owner has tagged `audience: "wot_commons"` or `"public"` (existing
`SharePolicyAudienceSchema`, D14 — `private | close | trusted | wot_commons | public`) are ever visible
outside that owner's device, and only in the aggregate/matched form the existing matcher chain and consent
flow already produce. No new visibility concept is required — the tier ladder is the consent-gate. What's
new is only the *export shape* (§2.2) for nodes that already cleared that gate, and (optionally, later) a
federated query/discovery layer that asks peers "do you have any `wot_commons`/`public` nodes of type X
matching Y" the same way item-matching already works today, rather than replicating data anywhere.

This also resolves cleanly against I3 (indistinguishable no): federated wiki queries are just another
kind of `REQUEST`, subject to the same uniform-schedule `PASS`/consent flow — not a new privacy surface.

---

## 3. Gap analysis: what v0.1's store interface already allows vs what's missing

**Method:** for each target-model capability, ask "reachable via a backend swap behind the existing
`Store` interface, or an additive method on it, without rewriting anything above the interface (I5)?"

| Capability | v0.1 today | Verdict |
|---|---|---|
| Backend swap (SQLite → graph/triple store later) | `Store` (`packages/agent-daemon/src/store/store.ts`) is the sole coupling point; nothing above it (lifecycle, matcher, REST/WS) touches SQL directly | **Yes, already satisfied (I5).** No seam change needed. |
| Schema-flexible node storage (EAV-like) | `sqlite_store.ts`'s `items` table already stores `labels_json`, `tags_json`, `provenance_json`, `policy_json` as JSON blobs, not normalized columns — the persistence layer is *already* schema-flexible under a typed read/write API (`ItemSchema.parse` on the way out) | **Yes, pattern already in use.** A generic `Node` table (`id, type, fields_json, tags_json, provenance_json, policy_json, created_at, updated_at`) is a straight generalization of the existing `items` table shape, not a new technique. |
| New node types (`Person`-as-Contact, `Agreement`, `Event`) | `Store` has one pair of methods per record kind (`putItem`/`getItems`, `putListing`/`getListings`, etc.) | **Additive only.** Each new node type is a new method pair (or, if generalized, one `putNode(type, ...)`/`getNodes(type)` pair) — purely additive to the interface, no existing method signature changes. |
| JSON-LD export | Pure transform of already-validated, already-typed records (§2.2) | **Yes, needs nothing new** — a read-side mapper function, not a store change. |
| Federated/global-wiki query across peers | Existing matcher chain + `TransportAdapter`/envelope model (I5) already do cross-device querying (`REQUEST`/`STATUS`/`CONSENT`) for `Item`s | **Extends the existing pattern**, not a new mechanism — generalizing "ask for a matching Item" to "ask for a matching Node of type X" is additive to the protocol layer, not the store. |
| **Per-field visibility** (Tana lets you share individual fields; today `policy.audience` is item-level only) | `SharePolicy` lives on the whole `Item`/node, not per-field | **Gap — but at the protocol/policy layer, not the store.** `evaluatePolicy` and `SharePolicySchema` would need to grow (e.g. a `field_policy?: Record<string, SharePolicy>` overlay) to support "share `display_name` but not `agreements`." This is a real, non-trivial design decision (❗ below), independent of storage engine. |
| **Open vs. fixed node types** (arbitrary user-defined supertags, Tana-style, vs. a closed enum the code knows about) | Today's five record kinds are a closed set baked into `Store`'s method signatures | **Design decision, not a store limitation.** A closed set of additive methods (current pattern) is simpler and keeps every node type zod-validated per its own schema (matches I6's "human-readable" bar better than fully-open fields). A fully open `type: string` + arbitrary `fields{}` (true Tana-style user-defined supertags) is more flexible but weakens validation and audit-log legibility. Flagged as ❗ below — it's Jakob's call, not inferable from kidur.org or the existing invariants. |

**Verdict: the `Store` interface (I5) itself needs no changes to support this extension.** The two real
open questions (per-field visibility, open vs. fixed node types) live one layer up, in
`packages/protocol/src/schemas.ts` (policy model) and in how many new store methods get added — both are
additive, backward-compatible design choices for whenever the extension is actually built, not gaps that
block it or require a v0.1 rewrite.

---

## 4. Migration path (3 steps, whenever this is actually built)

1. **Generalize the store's persistence shape, not its interface.** Add a generic `nodes` table
   (`id, type, fields_json, tags_json, provenance_json, policy_json, created_at, updated_at`) alongside
   (not replacing) the existing tables, and add `putNode`/`getNodes(type)`/`getNode(id)` to `Store`. Migrate
   `Item` first (it already matches the shape almost exactly) as the proof; leave `TrustEdge`, listings,
   loans, DM threads on their existing tables until/unless there's a reason to move them — I5 means this
   can happen incrementally, table by table, with zero disruption to code that hasn't been touched yet.
2. **Add the `Event` node type and JSON-LD export mapper.** `Event` nodes can start as a thin promotion
   layer over existing `AuditRecord`/`StewardLogRecord`/`RoomMessageRecord` rows (a read-side view, not a
   data migration) before deciding whether they deserve their own write path. The JSON-LD exporter is a
   pure function over already-validated records — ship it once, extend its `@type` mapping as new node
   types land.
3. **Decide and implement the two ❗ design questions from §3** (per-field visibility, open vs. fixed node
   types) as protocol-layer changes, then extend the federated-query envelope (generalizing `REQUEST` to
   carry a node-type filter) for the "global wiki" discovery flow. This step is the only one that touches
   `packages/protocol` schemas, and only additively (new optional fields/enums, per the same pattern D14
   used for `ListingTier`).

None of these three steps require touching v0.1's frozen `v: "0.1"` envelope types destructively, and step
1 can start at any time without waiting on steps 2–3 being decided.

---

## 5. ❗ Decision points for Jakob

- ❗ **Confirm the reading of "kidur core manner" (§1, confidence 0.7).** kidur.org documents an ethos
  (sovereignty, durability, chronological/developmental archive, transferability to heirs), not a storage
  architecture — there is nothing technical on the page to copy. This doc infers three implications
  (local-only, chronological `Event` node, exportability). Confirm, correct, or add anything from
  private/unpublished kidur design material this doc didn't have access to.
- ❗ **"Global wiki" semantics — federated-query or shared-replica?** This doc assumes federated: each
  peer's own store stays local, queried across the web of trust the same way item-matching works today,
  with only `wot_commons`/`public`-tier nodes ever visible off-device (§2.3). A shared/replicated store
  would violate I1/I2 outright and is NOT recommended, but the choice materially changes the sync/export
  design, so it should be stated explicitly rather than assumed.
- ❗ **Per-field visibility vs. item-level only (§3).** Tana-style selective field sharing is a real
  protocol-layer feature gap (not a store gap). Worth deciding whether the extension needs it from day one
  or can ship with today's item-level `policy.audience` and add field-level policy later.
- ❗ **Open (user-defined) vs. fixed (code-enumerated) node types (§3).** Fixed types keep zod validation
  and audit-log legibility (I6) strong; open types are more Tana-like/flexible but weaken both. Recommend
  fixed-but-extensible (new types added as new zod schemas + store methods, same pattern as D14's
  `ListingTier`) unless Jakob specifically wants end-user-defined supertags.
- ❗ **JSON-LD vocabulary alignment** — align `@context` with real-life-stack's existing `resource` schema
  (`docs/spec/schemas/`, HANDOVER §3) rather than inventing a parallel vocabulary, since Task 5 already
  targets that ecosystem. Confirm this is still the intended alignment target.

---

## 6. Sources, tiered

- [kidur.org](https://www.kidur.org/) — fetched directly 2026-07-18. Tier **C** (self-published, Jakob's
  own EvoBioSys-ecosystem project; no external editorial review). No subpages exist (`/docs`,
  `/architecture`, `/about`, `/whitepaper` all 404 as of this date).
- [Tana — Supertags](https://tana.inc/docs/supertags), [Tana — Fields](https://tana.inc/docs/fields),
  [Tana — Nodes and references](https://tana.inc/docs/nodes-and-references) — official product docs, via
  web search 2026-07-18 (direct fetch of `help.tana.inc`/`outliner.tana.inc/learn` redirected/404'd; used
  search-engine-cached descriptions of the same official pages instead). Tier **B** (vendor documentation,
  not independently audited, but authoritative for its own product's data model).
- JSON-LD / RDF triple model — general semantic-web knowledge (W3C JSON-LD 1.1 Recommendation model:
  `@context`/`@type`/`@id`, subject–predicate–object). Tier **A** (W3C standard), not re-fetched this
  session — well-established, high-confidence (0.95) background knowledge, cited for the mapping in §2.2
  only, not for any project-specific claim.
- [real-life-org/real-life-stack](https://github.com/real-life-org/real-life-stack) `resource` JSON-LD
  schema — per `HANDOVER-resource-web-sprint.md` §3 (already tiered B/C there); not re-fetched this
  session, referenced only for the export-vocabulary-alignment recommendation in §2.2/§5.
- This repo: `packages/agent-daemon/src/store/{types.ts,store.ts,sqlite_store.ts}`,
  `packages/protocol/src/schemas.ts`, `CLAUDE.md`, `HANDOVER-resource-web-sprint.md` §3,
  `docs/research/solo-graph-extension.md` — primary sources, read directly, tier A for this project's own
  ground truth.

---

File: `docs/research/storage-kidur-semantic.md` (this file). Untracked — not committed, per task brief.
