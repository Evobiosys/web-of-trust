# 70 — Placeholder Features (future circles)

Two features exist in the mockup as greyed entry points with anchor IDs. This doc spec
stubs them so implementers understand intent without building them yet.

Both are intentionally unspecified — they need community input before any flow is drawn.
The greyed UI communicates "held for a future circle."

---

## Amends (PLC-1)

**Entry point:** Greyed "Raise a flag" on a person's sheet.

**Intent:** When someone causes harm in a trusted space, there is a path that is
**restorative, not punitive**. The person is notified; context is scoped (a flag
raised in one community context doesn't globally brand them); an amends process happens
between affected parties; and restoration is marked by those affected — not by public
strikes, not by moderators alone.

**Explicit non-goals:**
- Public flags.
- Permanent marks or reputation damage.
- Anonymous accusations feeding automated scores.
- Automated judgments.

**Status:** Not designed yet. This needs community input on harm responses, restoration
language, and what "complete" looks like to those affected.

---

## Tags + blanket permissions (PLC-2, PLC-3)

**Entry points:**
- Greyed tag chips (`#ecstatic` `#dj` `#artist` `#facilitator` `#hippy` `#integral`)
  on person sheets (PLC-2).
- Greyed "Blanket permissions by tag" manager under You (PLC-3).

**Intent:** Tags are personal labels *a person applies to their own contacts*,
representing groups. The resource holder can then grant permission atoms blanket-wise
per tag — e.g., everyone tagged `#dj` sees your Friend-tier gear offers. Permissions
stay atomic underneath; tags are just bulk assignment UI.

Connection scoping fits here too: a connection can start limited to one context (e.g.,
"ecstatic-dance-related sharing only") and be upgraded later.

**Open questions:**
- Are tags visible to the tagged person?
- Tag vocabulary — free-form or curated?
- Conflict resolution: what wins if a person and their tag have different grants?
  (Intuition: per-person always wins.)

**Status:** Not designed yet. Needs UX exploration on tag visibility, vocabulary, and
how they interact with per-person permissions.
