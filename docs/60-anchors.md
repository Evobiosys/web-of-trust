# 60 — Anchor Registry

The sync hub between the mockup and the specs. Every specified surface in `mockup/index.html`
carries a `data-anchor` ID; this file is the source-of-truth list. See CONTRIBUTING.md for the
three-place rule and the sync check.

**ID scheme:** `DOMAIN-n`, per-domain monotonic, never recycled. Deleted anchors move to the
Retired table below (IDs are permanent).

**Status legend:** `Spec'd` — surface exists in the mock and has a contract section ·
`Placeholder` — greyed entry point only; spec stub in docs/70 · `Retired` — removed, ID reserved.

## ONB — Onboarding

| ID | Surface | Contract (one line) | Spec § | Status |
|---|---|---|---|---|
| ONB-1 | Welcome / threshold screen | Entry offers signup or logged-out browsing; identity is device-local, no account | 20 §Onboarding | Spec'd |
| ONB-2 | Quick vs Advanced signup | Two equal paths side-by-side with explainers; Quick = auto-managed keys, Advanced = verse + server choice | 20 §Onboarding · 30 ADR-6 | Spec'd |
| ONB-3 | Recovery verse (Advanced) | 12-word phrase display + keep confirmation; only path back without export | 20 §Onboarding · 30 ADR-7 | Spec'd |
| ONB-4 | Server pick + view source (Advanced) | Relay/server selectable at signup; source link communicated | 20 §Onboarding · 30 ADR-5 | Spec'd |
| ONB-5 | Name entry | Display name is self-asserted, editable, not unique | 20 §Onboarding | Spec'd |

## DIS — Discover

| ID | Surface | Contract (one line) | Spec § | Status |
|---|---|---|---|---|
| DIS-1 | Gatherings \| Offers segment + filters | Discovery is the default surface; events and offers are parallel browse sets | 20 §Discovery | Spec'd |
| DIS-2 | Public event card | Public events render for everyone incl. logged-out | 20 §Discovery | Spec'd |
| DIS-3 | Gated event card + invisibility rule | Visibility predicate returns items or NOTHING — never a locked/teaser state | 20 §Event visibility | Spec'd |
| DIS-4 | Map view | Same visibility predicate as list; gated markers only when opened | 20 §Discovery | Spec'd |
| DIS-5 | Logged-out state + join pitch | Public browse without identity; pitch explains member benefits | 20 §Onboarding | Spec'd |

## HST — Host a gathering

| ID | Surface | Contract (one line) | Spec § | Status |
|---|---|---|---|---|
| HST-1 | Create form (name/when/where) | Host-authored event record; location can be trust-gated separately from existence | 20 §Events | Spec'd |
| HST-2 | Tier picker + rings visual | Tiers: Public / The Commons / Friends / Close friends, mapped to ladder minimums | 20 §Event visibility | Spec'd |
| HST-3 | Advanced fold (steps) | Path-distance limit (1–3 steps) is advanced; default 2 | 20 §Event visibility | Spec'd |
| HST-4 | Reach list | Shows consenting people's names + "+N held privately"; never non-consenting names | 20 §Consent | Spec'd |
| HST-5 | Publish action | Publishing distributes per ADR-1 mechanism; host can edit/withdraw | 20 §Events · 30 ADR-1 | Spec'd |

## CER — Meet ceremony

| ID | Surface | Contract (one line) | Spec § | Status |
|---|---|---|---|---|
| CER-1 | Share composer (level presets + channels) | Offered level preset (Contact default); channel = QR/NFC/AirDrop/link carrying same payload | 20 §Handshake | Spec'd |
| CER-2 | Advanced atomic permissions | Pre-share permission atoms (context-limit, sharing types); skippable, adjustable later | 20 §Permissions | Spec'd |
| CER-3 | QR / handshake payload | Payload carries DID, name, enc key, nonce, ts, offered level; works offline | 20 §Handshake | Spec'd |
| CER-4 | Scan + confirm | Human confirms the person (face/name), picks level; auto-filled event context | 20 §Handshake | Spec'd |
| CER-5 | Mutual confirmation + celebration | Counter-attestation completes the pair; celebration only on mutual | 20 §Handshake | Spec'd |

## WEB — Your Web

| ID | Surface | Contract (one line) | Spec § | Status |
|---|---|---|---|---|
| WEB-1 | Rings layout | Ego-centric rings (never a global graph); ring 1 = direct, ring 2 = through-connections | 20 §Web view | Spec'd |
| WEB-2 | Person node + path sheet | Named path explanations ("You ⟷ Maria ⟷ Sofía"); no numeric trust values | 20 §Web view | Spec'd |
| WEB-3 | Consent clusters | Non-consenting second-ring people appear only as "+N held privately" | 20 §Consent | Spec'd |
| WEB-4 | Asymmetry labeling | Symmetric by default; one-way visibility always labeled "⚠ sees you: no" | 20 §Consent | Spec'd |

## INT — Introductions

| ID | Surface | Contract (one line) | Spec § | Status |
|---|---|---|---|---|
| INT-1 | Suggestion card | Quiet, dismissable, max 1–2; inputs are needs/offers/non-adjacency; no "AI" framing | 20 §Introductions · 30 ADR-12 | Spec'd |
| INT-2 | Introduce flow | Introducer consents both sides into contact; neither party auto-connected | 20 §Introductions | Spec'd |

## PPL — People

| ID | Surface | Contract (one line) | Spec § | Status |
|---|---|---|---|---|
| PPL-1 | Contact list + level badges | Ladder level + connection state per person; met-in-person context | 20 §Relationships | Spec'd |
| PPL-2 | Person sheet | Card view, level change entry, asymmetry label, placeholder entries | 20 §Relationships | Spec'd |

## RES — Resources

| ID | Surface | Contract (one line) | Spec § | Status |
|---|---|---|---|---|
| RES-1 | Offer card (browse) | Offer shows item, owner, tier badge, via-path; visibility uses the same predicate as events | 20 §Resources | Spec'd |
| RES-2 | Request sheet | Request goes to owner as Activity; no public request state | 20 §Resources | Spec'd |
| RES-3 | My resources management | Owner lists items w/ per-item tier; states Available/Requested/On loan/Returning | 20 §Resources | Spec'd |
| RES-4 | Loan state machine | requested→lent→returned→complete; both parties transition independently | 20 §Resources | Spec'd |
| RES-5 | Completion check-in | "Do you feel complete?" both sides; never stars; "not yet" visible only to own Close circle | 20 §Completions | Spec'd |
| RES-6 | Second-degree extension | Friend asks to offer my item to their web; owner approval required; revocable | 20 §Resources | Spec'd |

## ACT — Activity

| ID | Surface | Contract (one line) | Spec § | Status |
|---|---|---|---|---|
| ACT-1 | Bell + badge | Badge counts items awaiting ME (requests, approvals, check-ins); no engagement bait | 20 §Activity | Spec'd |
| ACT-2 | Activity list + item types | Item types: borrow-request, extension-approval, return-confirm, completion-check-in, level-change | 20 §Activity | Spec'd |

## YOU — Profile

| ID | Surface | Contract (one line) | Spec § | Status |
|---|---|---|---|---|
| YOU-1 | Profile + keys section | Copy reflects signup path (Quick: device-held keys; Advanced: verse) | 20 §Onboarding | Spec'd |
| YOU-2 | Visibility dial | "Show me to people my people trust" — symmetric default, exceptions labeled | 20 §Consent | Spec'd |
| YOU-3 | What you offer + Borrowed | Owner-side resource management entry | 20 §Resources | Spec'd |

## PLC — Placeholders

| ID | Surface | Contract (one line) | Spec § | Status |
|---|---|---|---|---|
| PLC-1 | Raise a flag (amends) | Greyed entry on person sheet; restorative process, not punitive strikes | 70 §Amends | Placeholder |
| PLC-2 | Tag chips on person sheet | Greyed #tags; groups of people for future blanket permissions | 70 §Tags | Placeholder |
| PLC-3 | Blanket permissions by tag | Greyed manager entry under You | 70 §Tags | Placeholder |

## Retired

| ID | Was | Retired when / why |
|---|---|---|
| — | — | — |
