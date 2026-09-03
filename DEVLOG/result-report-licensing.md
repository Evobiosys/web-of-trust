# Result — relicense to AGPL-3.0, AMPL on request, no-publish rule

Branch: `demo-2026-08-31` (unchanged from the current branch, as instructed). Committed locally.
**Nothing was pushed to any remote** (`github`, `ecstatic-world`, `jakobs-branch` untouched).

## Files changed

- `LICENSE` — replaced with the verbatim, unmodified GNU AGPL-3.0 text (see verification below).
  No copyright line was added inside it — LICENSE stays the FSF's document as-is; the copyright
  holder line lives in NOTICE instead.
- `LICENSE-AMPL-1.0` (renamed from `LICENSE`, via `git mv`) — the prior AMPL 1.0 text, byte-identical
  to the old `LICENSE` (`git show HEAD:LICENSE | diff - LICENSE-AMPL-1.0` → empty).
- `NOTICE` (new) — states AGPL-3.0-or-later, what it means in practice for a network-facing service
  built on this code, points to `LICENSE-AMPL-1.0` for the prior licence, and states the AMPL-on-request
  invitation honestly (a discovery mechanism, not a paywall) with the contact line as
  `Kontakt: <TODO: Jakob to fill in>` — **left exactly as the handover specified, not invented**.
- `README.md` — new `## Licence` section pointing at `LICENSE`, `NOTICE`, and `LICENSE-AMPL-1.0`,
  matching the existing terse README tone.
- `CLAUDE.md` — new "No push without explicit say-so" section placed right after the title, above
  `## Invariants` (I1–I9 numbering untouched — those IDs are referenced elsewhere). Names all three
  remotes and notes `github` already carries `alpha`, `cred-provider`, `rebiosys` from before this rule.
- `package.json` (root) and the 12 workspace manifests — added `"license": "AGPL-3.0-or-later"`
  (none of them had a `license` field before; this is an addition, not a correction). Files touched:
  `package.json`, `apps/dashboard/package.json`, `apps/demo/package.json`, `apps/device-ui/package.json`,
  `apps/mobile-ui/package.json`, `apps/web/package.json`, `packages/agent-daemon/package.json`,
  `packages/app-profiles/package.json`, `packages/browser-agent/package.json`,
  `packages/ew-contract/package.json`, `packages/network-access/package.json`,
  `packages/protocol/package.json`, `packages/transport/package.json`.
  All 13 verified as valid JSON (`node -e "JSON.parse(...)"`) after editing.

Not touched, deliberately: no per-file AGPL headers were added (repo-wide noise the handover
explicitly ruled out), and no file needed a header fix — the only `AMPL`/`Adapted Modular` hits
anywhere in the tracked tree were inside the handover doc itself; everywhere else "AMPL" only
matched substrings of unrelated words (`example`, `sample`) under a case-insensitive grep, not the
licence name. `reference/` is gitignored (external vendored clones, out of scope) and was left alone
even though a few of its own `package.json` files carry MIT/GPL-3.0 license fields — those aren't
this project's code.

## AGPL text verification

Fetched `https://www.gnu.org/licenses/agpl-3.0.txt` twice, independently, over two separate curl
calls — byte-identical both times, sha256 `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`.
Confirmed structurally complete: preamble present, all 18 numbered sections (0 Definitions through
17 Interpretation of Sections 15 and 16), and ends with the full "How to Apply These Terms to Your
New Programs" boilerplate including the standard notice block and the "Also add information on how
to contact you..." / remote-network-interaction / employer-disclaimer closing paragraphs. `LICENSE`
in the repo is a `cp` of that exact file (not retyped, not piped through a heredoc) —
`diff <fetched> LICENSE` is empty and its sha256 matches.

## Contradiction sweep

Grepped the whole tracked tree (excluding `node_modules`, `reference/`) for `AMPL`, `Adapted Modular`,
`SPDX-License`, and separately for `mozilla public|MPL[- ]?2|copyleft|licen[cs]e` (case-insensitive).
Also read `CONTRIBUTING.md` and `DECISIONS.md` in full — neither carries any contributor-licensing
language or a recorded AMPL decision, so no DECISIONS.md entry was needed. No contradictions found
anywhere outside the handover doc itself and the files this task intentionally changed.

## Constraint check

`npx tsc --noEmit` in `apps/demo` — passes clean (exit 0) after the `package.json` edits.

## Outstanding

**One TODO, the owner's to fill in:** the `Kontakt:` line in `NOTICE` currently reads
`Kontakt: <TODO: Jakob to fill in>`. No email or other contact detail was invented — replace that
placeholder with the real reach-out route before this NOTICE is meant to be relied on by anyone
outside the owner.

## Push status

Confirmed: no `git push` was run, to any of the three configured remotes. Confirmed no push-related
git hooks or `remote.pushDefault`/`autoSetupRemote` config exist that could push implicitly on
commit. Everything above is a local commit only, on `demo-2026-08-31`.
