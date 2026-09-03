# Handover — URL restructure on questhub (Caddy only, no app builds)

You own `/etc/caddy/Caddyfile` on the server for this task. Another stream owns
the app builds and will upload content into the directories you create. **Do not
build or upload any site content.** Create routes and empty directories only.

Server: SSH alias `questhub` (a ControlMaster session is already open, so plain
`ssh questhub '<cmd>'` works). Do NOT run ssh-add or any askpass setup.

## Target structure (from the project owner, verbatim intent)

- **Apps** all live under `idea2.site/wot`.
- **Demos** live under `app.idea2.site/wot/demo` — an overview page — with the
  individual demos at `app.idea2.site/wot/demo1`, `/wot/demo2`, `/wot/demo3` …
- `evobiosys.org/web-of-trust` and the other Web-of-Trust paths on
  `evobiosys.org` **redirect** into the above.
- **`rebiosys` stays on evobiosys.org.** It is the one thing that must not move
  or redirect. Verify `https://evobiosys.org/rebiosys/` still returns 200 when
  you are done.
- Relays stay on `questhub.eco` under the hood, unchanged. **Do not touch the
  `handle /relay/*` block** — it is live and load-bearing.

## Do this

1. **Back up first:** `sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d_%H%M%S)`.

2. **Create content dirs** (empty; another stream fills them):
   - `/srv/questhub-static/idea2-wot` — served at `idea2.site/wot*`
   - `/srv/questhub-static/app-idea2-wot` — served at `app.idea2.site/wot*`,
     with subdirectories `demo/`, `demo1/`, `demo2/`, `demo3/`, `demo4/`, `demo5/`

   ⚠️ **SELinux, learned the hard way today:** a new directory under
   `/srv/questhub-static/` gets context `var_t` and Caddy then serves 404 for
   everything in it. `restorecon` does NOT fix it. You must run:
   `sudo chcon -R --reference=/srv/questhub-static/wot-app <newdir>`
   Verify with `ls -dZ` that the context is `httpd_sys_content_t` before you
   call the route working. Also `chown -R almalinux:almalinux` and `chmod -R a+rX`.

3. **`app.idea2.site` block** — add ONE route, not six:
   ```
   handle_path /wot* {
       root * /srv/questhub-static/app-idea2-wot
       file_server
   }
   ```
   A single prefix with a directory tree behind it avoids Caddy path-matcher
   specificity puzzles entirely: `/wot/demo/` and `/wot/demo1/` are then just
   directories. Keep the existing `/unlocking-housing*` route and its
   `handle / { redir ... }` working — check that `https://app.idea2.site/`
   still redirects to unlocking-housing afterwards.

4. **`idea2.site` block** — there are currently TWO conflicting `handle_path
   /wot*` blocks plus a `redir` that shadows both (every `/wot*` path 302s to
   `/web-of-trust/` today, which is why `/srv/questhub-static/wot` has been
   unreachable). Untangle it so `idea2.site/wot*` serves
   `/srv/questhub-static/idea2-wot`. Remove the shadowing redirect and the dead
   duplicate route. Leave `/wot-demo*` alone for now — the old demo URL must
   keep working until the new one is verified; a later pass will redirect it.

5. **Trailing-slash canonicalisation.** This is the bug that caused a black page
   on a phone this morning: `idea2.site/wot-demo` (no slash) served the HTML but
   resolved its relative `./assets/*` against `/`, so CSS and JS both 404'd.
   For every new static route, make sure a request without the trailing slash
   redirects to the one with it. Caddy's `file_server` does this for real
   directories, but `handle_path` strips the prefix first, so verify by actually
   curling `…/wot/demo` and `…/wot/demo1` (no slash) and confirming a 301/302 to
   the slashed form rather than a 200 with a broken body.

6. **evobiosys.org redirects.** Redirect `/web-of-trust*` and the other
   Web-of-Trust paths to `https://idea2.site/wot{uri}` (or the demo overview
   where that is the better target — use judgement, and say what you chose).
   **`/rebiosys*` must be excluded from this and keep working.** List every
   evobiosys.org path you touched.

7. **Validate and reload:** `sudo caddy validate --config /etc/caddy/Caddyfile`
   then `sudo systemctl reload caddy`. If validate fails, restore your backup.

## Verify before reporting (curl from the server or from your own shell)

Record the actual HTTP status for each, do not assume:
- `https://evobiosys.org/rebiosys/` → must be 200
- `https://questhub.eco/relay/send` (POST `{"to":"did:peer:2.x"}`) → must still be 202
- `https://app.idea2.site/` → still redirects to unlocking-housing
- `https://idea2.site/wot-demo/` → still 200 (old demo must not break)
- `https://app.idea2.site/wot/demo` and `/wot/demo1` (no trailing slash) →
  301/302 to the slashed form
- The new dirs are empty, so a 404 from `…/wot/demo/` is EXPECTED at this stage.
  Prove the route works by dropping a temporary `index.html` containing the
  single word `ok`, curling it, then deleting it again.

## Report

Write `DEVLOG/result-report-url-restructure.md` in
`/Users/personal/Documents/SingularStructure/PROJECTS/evobiosys/evobiosys-PROJECTS/EvoBioSys-cross/PROJECTS/web-of-trust/Code/primary-repo/`:
the exact Caddyfile diff, the backup filename, every URL you tested with its
status, and anything you chose differently from this document and why.
Summarise in your reply. Do not commit anything to git.
