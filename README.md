# Ecstatic World — Web of Trust Prototype

A clickable, mobile-first mockup of a web-of-trust for the ecstatic dance community: people meet
in person on or near the dance floor, confirm each other face to face, and a trust graph gates
what each person can see — events, offers, and people. This repo is the **shared design surface**:
the mockup shows the intended experience, the docs specify the contracts behind it, and the
architecture decisions are left open for the implementation team to make.

**Status:** v6 · design prototype only · nothing here is production code.

## Run it

Open `mockup/index.html` in any modern browser. No build, no server, no dependencies — it is one
self-contained HTML file. On a phone-sized viewport it renders full-screen; on desktop it shows a
phone frame with a collaborators panel.

## The golden demo path

1. From the welcome screen, tap **Just look around** — browse public events logged-out, tap a
   gated interaction to see the join pitch.
2. Go back and choose **Quick signup** (note the Advanced option beside it), pick your name.
3. Tap the center **Meet** shutter: the share composer. Note the level presets (Contact is
   default), the channel row, and the Advanced permissions fold. Tap **Scan theirs instead**.
4. The simulated scan finds **Maria**. Choose **Friend**, confirm. Watch the celebration — then
   **See what opened**: the Moon Ceremony appears in Discover. (Redo with **Contact** and it
   stays closed: levels gate depth.)
5. In **Discover → Offers**, request Lucía's speakers. Open the **bell (Activity)** to walk the
   loan loop: lent → returned → "Do you feel complete?" on both sides.
6. In Activity, approve Rafa's request to extend your cacao offer to his web (second-degree).
7. In **Your Web**, see the rings, tap Bruno ("⚠ sees you: no" — labeled asymmetry), and act on
   the quiet introduction suggestion below the rings.
8. Tap **＋ Host** in Discover: pick a tier (Public / The Commons / Friends / Close friends),
   watch the reach list update; steps live under Advanced.

## Spec mode (for implementers)

Append `#spec` to the file URL (or use the "Spec mode" toggle beside the phone). Every specified
surface gets a dashed outline and an ID badge (e.g. `CER-4`). Tap a badge to see its one-line
contract and which doc section specifies it. The full registry lives in
[`docs/60-anchors.md`](docs/60-anchors.md).

## Doc map

| Doc | What it is | Read it if you are… |
|---|---|---|
| [00-overview](docs/00-overview.md) | Thesis, trust ladder, tiers, glossary, surfaces | everyone — start here |
| [10-ux-decisions](docs/10-ux-decisions.md) | The workshop decision log (what was decided and why) | designing or questioning UX |
| [20-data-contract](docs/20-data-contract.md) | UX→backend contract, keyed by anchor IDs | implementing anything |
| [30-architecture-decisions](docs/30-architecture-decisions.md) | Open decisions: context + recommendation, **your call** | the architecture team |
| [40-infra](docs/40-infra.md) | Infra explainer — **HOLD OFF, do not build yet** | ops-curious |
| [50-community-explainer](docs/50-community-explainer.md) | Plain-language public explainer | showing the community |
| [60-anchors](docs/60-anchors.md) | Anchor registry (mock ↔ spec sync) | implementing anything |
| [70-placeholders](docs/70-placeholders.md) | Amends flow + tags/permissions — future circles | curious about what's next |

See [CONTRIBUTING.md](CONTRIBUTING.md) before changing anything.
