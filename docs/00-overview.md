# 00 — Overview

Read this one first. It is the shared mental model — the mockup, the other docs, and the anchor
registry all assume you already have this.

## 1. Thesis

Ecstatic World is bringing decentralized-web primitives — device-held identity and a peer-to-peer
trust graph — to a real in-person movement: ecstatic dance and the adjacent conscious-movement
practices around it. People already meet face to face at events; this prototype gives that meeting
a digital counterpart. Two people confirm each other in a ceremony that takes about 20 seconds, and
the resulting web of trust gates what each of them can see afterward: public events for everyone,
but private gatherings, offers, and people only through real relationships.

The point is not a smarter directory. It is rebuilding the trust that big platforms eroded, and
honoring data sovereignty — your people, your events, your web live with you, not in a company
database. This is a prototype, a living experiment in what that could feel like. It is not a
product claim.

## 2. The trust ladder

Three levels, chosen at the handshake and upgradable later. Levels have teeth — they gate depth,
not just describe a relationship.

| Level | What it is | What it unlocks |
|---|---|---|
| **Contact** | The dance-floor default. You exchange cards, nothing else. | No network visibility either way. |
| **Friend** | You're in each other's web. | You see Friend-gated events and offers; you appear in each other's second rings (with consent). |
| **Close friend** | The inner room. | Close-gated events, more intimate sharing, deeper resource permissions. |

## 3. Event and offer visibility tiers

Four tiers, plus a path-distance limit (how many steps through the web someone can be from you and
still qualify — default 2, adjustable under Advanced):

- **Public** — everyone, even logged out.
- **The Commons** — anyone connected at any level.
- **Friends** — Friend level or closer.
- **Close friends** — Close friend level only.

**The invisibility rule.** Anything you lack the trust path for simply does not render. Never a
locked card, never a teaser. This is a hard product rule, not a style preference — see
CONTRIBUTING.md's fence list and anchor `DIS-3`.

## 4. Glossary

- **Trust ladder** — the three connection levels: Contact, Friend, Close friend.
- **Contact / Friend / Close friend** — see §2. Contact is the default at first meeting.
- **The web** — the trust graph as a whole; the network of real, consented connections.
- **Your web (rings view)** — your own ego-centric view of the web: concentric rings, never a
  global graph.
- **Thread** — a mutual connection between two people. Plain functional UI avoids this word; it is
  reserved for the poetic register — the mutual celebration ("Woven.") and the Your Web view.
- **Tier** — a visibility level on an event or offer: Public, The Commons, Friends, Close friends.
- **The Commons** — the tier open to anyone connected at any level, however lightly.
- **Steps** — path-distance through the web; the advanced reach setting under a tier.
- **Held privately (+N clusters)** — second-ring people who haven't consented to be shown by name;
  they still count, just not by name.
- **Visibility dial** — "Show me to people my people trust." Symmetric by default; any exception is
  always labeled, never silent ("sees you: no").
- **Handshake / ceremony** — the in-person moment two people confirm each other and set a level.
- **Card** — the r-card–style contact card exchanged at a handshake.
- **Offer / resource** — something a person makes available to their web (a loan, a skill, a space).
- **Loan loop** — the lifecycle of a borrowed offer: requested, lent, returned, complete.
- **Completion check-in** — "Do you feel complete?", asked of both parties at the end of a loan.
  Never a star rating. Unresolved incompleteness is visible only within one's own Close-friend
  circle.
- **Activity (the bell)** — the overlay of things awaiting you: requests, approvals, check-ins.
- **Introduction suggestion** — a quiet nudge that two people in your web who don't know each other
  might want to ("threads that could meet").

## 5. The six surfaces

- **Discover** — the default surface. Gatherings and Offers segments, list and map views.
- **Your Web** — the concentric rings, named paths between you and others, and quiet introduction
  suggestions below the rings.
- **Meet** — the center shutter. The share composer and the QR handshake ceremony live here.
- **People** — your contacts: levels, cards, per-person detail.
- **You** — your profile, your keys, your visibility dial, and what you offer.
- **Activity** — the bell overlay (not a tab): requests, approvals, and check-ins waiting on you.

## 6. What v6 demonstrates vs. what's placeholder

**Interactive and demoable:**

- The handshake, with levels
- Gated discovery (events and offers both obey the visibility predicate)
- The host flow, with tiers and a live reach estimate
- The resource loop, including second-degree extension with owner approval
- Quiet introduction suggestions
- Quick and Advanced signup, side by side
- Logged-out browsing
- Asymmetry labeling ("sees you: no")

**Placeholder only** (greyed in the mockup, spec'd in `docs/70-placeholders.md`):

- Red-flag → amends restorative process
- Tags (e.g. `#dj`, `#facilitator`) and per-tag blanket permissions

## 7. Reading order by audience

| You are… | Read, in order |
|---|---|
| A backend implementer | 00 → 60-anchors → 20-data-contract → 30-architecture-decisions |
| A UX collaborator | 00 → 10-ux-decisions → the mockup, with `#spec` on |
| A community member | 50-community-explainer |
