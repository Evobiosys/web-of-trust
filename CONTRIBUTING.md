# Contributing

## Ownership

- **Mockup + UX docs (00, 10, 50, 60, 70):** Zach (UX owner). Propose changes, don't merge them
  silently.
- **Architecture decisions (docs/30):** the implementation team. Each ADR is OPEN until you close
  it — edit the doc with your decision + date + who decided.
- **Data contract (docs/20):** shared. Contract changes land as a docs PR *before* the mockup or
  any implementation changes to match.

## The mockup is one file, on purpose

`mockup/index.html` is a single self-contained HTML file:

- No build step, no dependencies, no external requests of any kind (it is published behind a
  strict CSP: no CDNs, fonts, images, fetch). Inline CSS/JS only.
- One editor at a time — a single 1000+ line HTML file is merge-hostile. Coordinate before
  touching it.
- It must open from disk with zero console errors, in light and dark page themes, and render
  static under `prefers-reduced-motion`.

## The three-place anchor rule

Every specified surface in the mock carries a `data-anchor="XXX-n"` attribute. An anchor exists
in exactly three places, always together:

1. the `data-anchor` attribute in `mockup/index.html`,
2. an entry in the in-file `ANCHORS` JS registry (title, one-line contract, doc ref),
3. a row in `docs/60-anchors.md`.

Add or change a surface → update all three in the same commit. Check sync with (anchors are
applied both as static `data-anchor="…"` attributes and via `setAttribute`/item fields at render
time, so the check compares the JS registry to the doc, then confirms every ID has at least one
usage site beyond the registry):

```sh
grep -oE '"(ONB|DIS|HST|CER|WEB|INT|PPL|RES|ACT|YOU|PLC)-[0-9]+":' mockup/index.html \
  | grep -oE '[A-Z]{3}-[0-9]+' | sort -u > /tmp/js.txt
grep -oE '^\| (ONB|DIS|HST|CER|WEB|INT|PPL|RES|ACT|YOU|PLC)-[0-9]+' docs/60-anchors.md \
  | grep -oE '[A-Z]{3}-[0-9]+' | sort -u > /tmp/doc.txt
diff /tmp/js.txt /tmp/doc.txt          # must be empty
for id in $(cat /tmp/doc.txt); do      # every ID must appear at a usage site too
  [ "$(grep -c "$id" mockup/index.html)" -ge 2 ] || echo "USAGE-MISSING: $id"
done
```

ID scheme: per-domain prefixes (`ONB DIS HST CER WEB INT PPL RES ACT YOU PLC`), monotonically
increasing, **never recycled** — retired anchors stay listed in 60-anchors.md as retired.

## Brand fences (hard rules, checked before merge)

- The interface and the community explainer never say **"AI"**, "algorithm", "smart", or name any
  automated system. Suggestion features are phrased as the web noticing ("Rafa is looking for
  speakers…").
- No **ratings, scores, stars, streaks, or engagement metrics** — anywhere. Completion check-ins
  are "Do you feel complete?", never a number.
- Trust language: plain verbs for actions ("Add", "Connected", "Pending"); the weave poetry
  appears only at the mutual celebration ("Woven.") and in the Your Web view.
- Private things are **invisible, not locked**: no teaser cards, no lock icons on things a person
  cannot access. If the predicate fails, nothing renders.
- Palette, motifs, and voice follow the Ecstatic World design bible (violet `#9A37F0`, electric
  `#12A8E3`, coral `#FF715B` for ceremonial actions, mint `#4FD7A0`, mist/linen surfaces; the
  spectrum gradient appears only at the mutual-verification celebration).

Fence scan (expected: zero hits in interface strings; review any hit by eye):

```sh
grep -inE '\b(AI|algorithm|rating|score|stars?)\b' mockup/index.html docs/50-community-explainer.md
```

## Verification pass (run before any release/republish)

1. Open `mockup/index.html` from disk — zero console errors; light + dark; reduced-motion static;
   phone-width viewport.
2. Anchor sync greps (above) — empty diff, and the JS `ANCHORS` keys match.
3. Fence scan — clean.
4. Self-containment: `grep -nE 'https?://|fetch\(|@import|<link' mockup/index.html` — no network
   surfaces (human-readable doc-reference strings are fine).
5. Walk the README golden demo path end to end.
