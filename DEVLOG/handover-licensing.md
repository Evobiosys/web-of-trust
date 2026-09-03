# Handover — relicense to AGPL-3.0, AMPL on request, and a no-publish rule

Repo: `/Users/personal/Documents/SingularStructure/PROJECTS/evobiosys/evobiosys-PROJECTS/EvoBioSys-cross/PROJECTS/web-of-trust/Code/primary-repo`
Branch: work on `demo-2026-08-31` (the current branch). Commit locally.
**Do not push to any remote. Not to `github`, not to `ecstatic-world`, not to
`jakobs-branch`.** Pushing is the owner's decision and he has to make it himself.

## The owner's intent, in his words

> make any code that is there currently agpl 3 and make a note that they can
> reach out to me to make it accessible under ampl. this is to 1) make it open
> source and 2) make sure that we know those who would be building outside of a
> copyleft / (one version of the) commons manner

Two purposes, and the wording must serve both: AGPL-3.0 is the default grant so
the work is genuinely open source, and the AMPL route exists so that anyone who
needs terms outside copyleft has to come and say so. The second is a
*discovery* mechanism, not a paywall. Do not write it as "commercial licence
available" boilerplate; write it as an invitation to get in touch.

Copyright holder: **Jakob Possert-Bienzle** (as in the current LICENSE file).

## Do this

1. **`LICENSE`** — replace the current Adapted Modular Public License 1.0 text
   with the verbatim, unmodified GNU Affero General Public License v3.0. Do not
   paraphrase, retype from memory, or trim it: fetch or reproduce the official
   text exactly, and verify it is complete (it ends with the "How to Apply These
   Terms to Your New Programs" section). A mangled AGPL is worse than no licence.

2. **Keep the AMPL text.** Move the existing licence to `LICENSE-AMPL-1.0` so
   it is still in the tree and still citable, rather than deleting it.

3. **`NOTICE`** (new, at the repo root) — short, plain, and it must say:
   - the work is licensed under AGPL-3.0, and what that practically means here
     (a network-facing service built on this code has to offer its source to
     its users);
   - that the AMPL 1.0 text lives at `LICENSE-AMPL-1.0`;
   - that anyone who wants to use this outside AGPL terms should reach out, and
     that this is deliberate: the owner wants to know who is building outside a
     copyleft/commons frame. Say that honestly rather than dressing it up.
   - a contact line. **Do not invent an email address or any other contact
     detail.** Write `Kontakt: <TODO: Jakob to fill in>` and flag it in your
     report as the one thing he must complete.

4. **`README.md`** — add a short Licence section pointing at both files and the
   reach-out route. Match the README's existing tone; read it first.

5. **Per-file headers** — do NOT add AGPL headers to every source file. It is
   noise across a repo this size and the LICENSE file governs. If any file
   currently names AMPL in a header comment, update just those.

6. **`CLAUDE.md`** — add a short, unmissable rule near the top:
   nothing in this repo gets pushed to a public remote (GitHub in particular)
   without the owner's explicit say-so, per push. Note that the repo has three
   remotes configured (`github`, `ecstatic-world`, `jakobs-branch`) and that
   `github` already has `alpha`, `cred-provider` and `rebiosys` branches on it
   from before this rule existed.

7. **Check for contradictions.** Grep the repo for existing licence claims
   (`AMPL`, `Adapted Modular`, `SPDX`, `license` fields in `package.json` files)
   and make them consistent with AGPL-3.0. `package.json` `license` fields
   should read `AGPL-3.0-or-later`. List everything you changed.

## Constraints

- Do not change any code behaviour. This is licensing and documentation only.
- `npx tsc --noEmit` in `apps/demo` must still pass if you touch any
  `package.json` (a bad edit there breaks resolution).
- German is not needed here; these files are English, matching the repo.
- Commit locally with a clear message. Do not push.

## Report

Write `DEVLOG/result-report-licensing.md`: every file changed, confirmation
that the AGPL text is complete and unmodified, the list of contradictions you
found and fixed, and the outstanding TODO (the contact line). Summarise in your
reply, and state plainly that nothing was pushed.
