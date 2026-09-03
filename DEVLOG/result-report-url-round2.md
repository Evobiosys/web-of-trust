# Result — URL restructure, round 2 (Caddy on questhub)

Executed 2026-09-03. Server: questhub (ov-18b91e.infomaniak.ch, AlmaLinux 10).

## Backup

- `/etc/caddy/Caddyfile.bak.20260903_071144` — taken immediately before this
  round's edit, after a sha256 race-check against the copy fetched at the
  start of the session (matched — no concurrent writer touched the file in
  between; see "Concurrency check" below).

Restore with `sudo cp /etc/caddy/Caddyfile.bak.20260903_071144 /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

## Discovery: state had moved on since round 1's own report

Before editing, I re-read the live Caddyfile rather than trusting round 1's
report as current. It wasn't fully current:

- Round 1's report documents backups ending at `...063957`, but a further
  backup `...064653` existed on disk, and a diff of it against the live file
  showed the `app.idea2.site/relay/*` → `127.0.0.1:4177` proxy had since been
  added — resolving one of round 1's own "Decisions needed" items. This
  round's handover already assumes that proxy exists ("already proxies to
  the same process for browsers"), so it's consistent, just undocumented in
  the round-1 report file itself. No action needed, noted for the record.
- `idea2.site/wot/` was serving real content (title "Vertrauensnetz", German,
  linking out to `app.idea2.site/wot/demo`, `/demo1/`, `/demo1/nachweis/`) at
  `/srv/questhub-static/idea2-wot/index.html`, born 06:48:18 — after every
  backup above. Round 1's own report says this directory was left empty. I
  did not chase down who/what wrote it; it doesn't change what this round's
  handover asks for (retarget `idea2.site/wot*` to a redirect), so I
  proceeded, but the file itself is now orphaned — see below.
- `idea2.site/web-of-trust*` had **two** conflicting `handle_path` blocks.
  The first (`root /srv/questhub-static/wot-mockup`, title "Gathering World —
  Web of Trust Mockup") was winning and serving live; a second, further down,
  pointed at `/srv/questhub-static/web-of-trust` (the correct green content)
  but was dead/shadowed and never reached. Same bug class round 1 already
  fixed once for `/wot*` (first-match-wins `handle_path` duplication).

## Colour mismatch — flagging per the handover's instruction

⚠️ The page now live at `idea2.site/web-of-trust/` is **green**
(`#0f1a14`, `#9dc79a`), not purple as the owner described. Per the handover,
this is deliberate: the owner identified the green page as the homepage and
the periwinkle/blue-purple one — title "Web of Trust · EvoBioSys", at
`/srv/questhub-static/evobiosys-org/systems/web-of-trust/` — as its subpage,
which matches the site structure. That periwinkle page is now behind a 302
redirect (see table below) rather than serving directly. **If this is the
wrong page, the one-sentence fix is: "swap what's copied into
`/srv/questhub-static/idea2-web-of-trust/` for
`/srv/questhub-static/evobiosys-org/systems/web-of-trust/` instead."**

## Content directory created

- `/srv/questhub-static/idea2-web-of-trust/` — copy (not move) of
  `/srv/questhub-static/web-of-trust/index.html` only (19 KB, matches the
  handover's description exactly). `/srv/questhub-static/web-of-trust/`
  itself is untouched, per the handover's "do not move it out from under
  whatever else may still reference it."
- I initially also copied the sibling `draft/` subdirectory (same title, no
  `noindex`), which would have made `idea2.site/web-of-trust/draft/` a new
  public URL that didn't exist before and that the handover never named.
  Removed it after the fact (`sudo rm -rf .../idea2-web-of-trust/draft`) to
  stay strictly to what was asked — confirmed `idea2.site/web-of-trust/`
  still 200 and `.../draft/` now 404. The original at
  `/srv/questhub-static/web-of-trust/draft/` is untouched and was never
  routed to begin with.
- `chcon -R --reference=/srv/questhub-static/wot-app`, `chown -R
  almalinux:almalinux`, `chmod -R a+rX`. Verified `httpd_sys_content_t` on
  both the directory (`ls -dZ`) and the served file itself (`ls -Z
  index.html`) — not `var_t`.

No other new directories were created this round (item 3's mobile-UI move
was not implemented — see below).

## Link audit of the deployed page (content review, no edits made)

The page was authored to live at `evobiosys.org/web-of-trust/`; I checked
every `href`/`src` in it for anything that would break or read oddly at its
new home. Full list pulled via
`grep -oE '(href|src)="[^"]+"' .../idea2-web-of-trust/index.html`:

- All root-relative and absolute links resolve correctly **except two**,
  both content, not routing — flagging only, per the handover's Caddy-only
  scope:
  - **`<a href="https://questhub.eco">QuestHub</a>`** (footer/nav) — a bare
    link to questhub.eco from the page that item 3 is specifically trying to
    get questhub.eco *out* of the user-facing surface for. Contradicts that
    goal on the very page you'll open first.
  - **`<a href="/wot/">idea2.site/wot</a>`**, in the line "…also reachable
    at idea2.site/wot" — no longer a separate mirror; `/wot/` now redirects
    straight back to this same page (confirmed, 302 → itself). Not a broken
    link, just stale copy claiming a second URL that no longer does anything
    different.
  - Both are page-content fixes, not Caddy routing — outside what I touched
    this round.

## Caddyfile diff (backup → live, full and final)

```diff
@@ idea2.site @@
 	handle_path /weboftrust* {
 		redir https://idea2.site/web-of-trust/
-	}
-	handle_path /web-of-trust* {
-		root * /srv/questhub-static/wot-mockup
-		file_server
 	}
 	...
+	@web_of_trust_bare path /web-of-trust
+	redir @web_of_trust_bare /web-of-trust/ 308
 	handle_path /web-of-trust* {
-		root * /srv/questhub-static/web-of-trust
+		root * /srv/questhub-static/idea2-web-of-trust
 		file_server
 	}
-	@wot_bare path /wot
-	redir @wot_bare /wot/ 308
 	handle_path /wot* {
-		root * /srv/questhub-static/idea2-wot
-		file_server
+		redir https://idea2.site/web-of-trust/ temporary
 	}

@@ evobiosys.org (inside root's route{}) @@
 		handle_path /web-of-trust/draft-prototype* {
 			redir https://app.idea2.site/wot/demo/ temporary
 		}
 		handle_path /web-of-trust* {
-			redir https://idea2.site/wot{uri} temporary
+			redir https://idea2.site/web-of-trust/ temporary
 		}
+		handle_path /systems/web-of-trust* {
+			redir https://idea2.site/web-of-trust/ temporary
+		}
+		handle_path /wot* {
+			redir https://idea2.site/web-of-trust/ temporary
+		}
+		handle_path /s/wot* {
+			redir https://idea2.site/web-of-trust/ temporary
+		}
```

(Full diff is in the live file's inline comments, which explain each change
and what it superseded — same convention round 1 used.)

**All new/retargeted redirects are `temporary` (302), per the owner's
explicit instruction. Nothing was promoted to 301.** The one `308` in this
change (`@web_of_trust_bare`, the bare-path-to-slash guard on the new
`/web-of-trust` mount) is not a content redirect — it's the same
trailing-slash canonicalization guard round 1 used for `/wot`, required
because `handle_path` strips the prefix before `file_server` can add the
slash itself. It existed under the old `/wot*` mount already; it just moved
to guard `/web-of-trust*` now that `/web-of-trust*` is the one serving files
via `file_server` and `/wot*` is a plain redirect (which needs no such guard
— a `redir` target doesn't have file_server's canonicalization gap).

## What I chose differently from the handover, and why

1. **Removed the shadowing `wot-mockup` block on idea2.site rather than
   picking a different URL for it.** It was the only reference to
   `/srv/questhub-static/wot-mockup` anywhere in the Caddyfile (confirmed by
   grep) — an orphaned older mockup squatting on the URL the handover names
   as the front door. Files left untouched on disk at
   `/srv/questhub-static/wot-mockup/`, just no longer routed.
2. **`idea2.site/wot*`'s old `@wot_bare` trailing-slash guard was deleted,
   not kept.** It existed only to fix `file_server`'s canonicalization gap;
   the block now redirects unconditionally, so there's no gap left to guard,
   and keeping it would have produced a 308→302 double-hop on `idea2.site/wot`
   instead of the single 302 the handover's verification table expects.
3. **Item 3 (mobile-UI app move) — not implemented, per the handover's own
   escape hatch.** Fetched `questhub.eco/wot-app/index.html`: its
   `<script>`/`<link>` tags reference `/wot-app/assets/index-CDebA1KP.js` and
   `/wot-app/assets/index-DVIA0xVi.css` — absolute paths rooted at
   `/wot-app/`, confirmed still serving 200 at that path today. Moving this
   build to `app.idea2.site/wot/app/` without a rebuild would make the
   browser request `/wot-app/assets/...` off the `app.idea2.site` origin,
   which falls through to the existing `handle_path /wot*` (demos) mount and
   404s — no matching files there. Per the handover, left the old route
   (`questhub.eco/wot-app/*`) working and did not add the
   `questhub.eco/wot-app* → redirect` either, since there is nowhere correct
   yet to send it. **Zero-rebuild option, if wanted before the app stream
   rebuilds it properly:** mount the same `/srv/questhub-static/wot-app`
   directory at `app.idea2.site/wot-app/` (same path suffix, different
   origin) placed *above* the existing `handle_path /wot*` block so it isn't
   swallowed by it — the absolute asset paths would then resolve with no
   rebuild, just not at the `/wot/app/` URL the handover asked for. Owner's
   call, not mine to make.
4. **`questhub.eco/relay/*` — untouched**, confirmed still live and 202
   throughout (see verification table). No change was needed; it was already
   in the state the handover describes.

## Orphaned content (files untouched on disk, no longer routed)

- `/srv/questhub-static/wot-mockup/` — was live at `idea2.site/web-of-trust/`
  before this round, now unreachable.
- `/srv/questhub-static/idea2-wot/` — the "Vertrauensnetz" page (see
  Discovery above), was live at `idea2.site/wot/`, now unreachable (redirects
  to the new front door instead).
- `/srv/questhub-static/evobiosys-org/systems/web-of-trust/`,
  `/srv/questhub-static/evobiosys-org/wot/`,
  `/srv/questhub-static/evobiosys-org/s/wot/` — all now behind 302s to the
  new front door instead of serving directly.

None of these were deleted or modified — only the routing changed.

## Full verification (all curl'd fresh after reload, no `-L`)

| Check | Result |
|---|---|
| `idea2.site/web-of-trust/` | **200** ✅ |
| `idea2.site/web-of-trust` (no slash) | 308 → `/web-of-trust/` ✅ (canonicalization guard, not a content redirect) |
| `idea2.site/wot` | **302** → `https://idea2.site/web-of-trust/` ✅ (single hop, no 308 first) |
| `idea2.site/wot/` | **302** → `https://idea2.site/web-of-trust/` ✅ |
| `evobiosys.org/web-of-trust/` | **302** → `https://idea2.site/web-of-trust/` ✅ |
| `evobiosys.org/systems/web-of-trust/` | **302** → `https://idea2.site/web-of-trust/` ✅ |
| `evobiosys.org/wot`, `/wot/` | **302** → `https://idea2.site/web-of-trust/` ✅ |
| `evobiosys.org/s/wot`, `/s/wot/` | **302** → `https://idea2.site/web-of-trust/` ✅ |
| `evobiosys.org/rebiosys/` | **200** ✅ hard constraint |
| `POST questhub.eco/relay/send {"to":"did:peer:2.x"}` | **202** ✅ hard constraint |
| `POST app.idea2.site/relay/send` same body | **202** ✅ hard constraint |
| `app.idea2.site/wot/demo/` | **200** ✅ unaffected, unchanged |
| `idea2.site/wot-demo/` | **200** ✅ regression check — precedes `/wot*` in file order, unaffected |
| `questhub.eco/wot-app/` | **200** ✅ left in place, per item 3 decision |
| `evobiosys.org/web-of-trust/draft-prototype/x` | 302 → `app.idea2.site/wot/demo/` ✅ unaffected, still above the broader `/web-of-trust*` block |
| `questhub.eco/demos` | 302 → `app.idea2.site/wot/demo/` ✅ unaffected, round 1's change |
| SELinux context, `idea2-web-of-trust/` + `index.html` | `httpd_sys_content_t` ✅ |
| `caddy validate` | Valid configuration |
| `systemctl is-active caddy` | active, post-reload |
| `journalctl -u caddy` post-reload | only pre-existing, unrelated ACME failures for `museum.idea2.life` and `www.app.unlocking-housing.org` (NXDOMAIN, untouched domains — same two round 1 saw) |

## Concurrency check

Between fetching the live Caddyfile at the start of this session and writing
the backup, I re-hashed the live file on the server (`sha256sum`) and
compared it to the hash of the copy I'd been editing against. They matched —
no other writer touched `/etc/caddy/Caddyfile` in between. One edit pass, one
validate, one reload, as instructed.

## Decisions needed

- ❗ **Colour**: confirm the green page at `idea2.site/web-of-trust/` is the
  one you meant as the homepage (see "Colour mismatch" above) — one-sentence
  fix if not.
- ❗ **`questhub.eco/wot-app/*`** (mobile-UI, "Ecstatic World" mockup) is
  still directly served from questhub.eco — not moved, not redirected,
  because the build's absolute `/wot-app/` asset paths would 404 anywhere
  else without a rebuild. Zero-rebuild interim option described above under
  "What I chose differently," item 3, is available if you want it off
  questhub.eco sooner than the rebuild.
- The orphaned `wot-mockup` and `idea2-wot` ("Vertrauensnetz") content is
  left on disk, unrouted. No action needed unless you want it deleted or
  repointed somewhere.
- ❗ **Front-door page content, not routing**: the deployed page links
  `https://questhub.eco` by name (contradicts item 3's "get questhub.eco out
  of the user-facing surface") and says "also reachable at idea2.site/wot",
  which now just redirects back to the same page. Both need a content edit
  in the page itself — outside this round's Caddy-only scope, flagged for
  whoever owns that page's source.
