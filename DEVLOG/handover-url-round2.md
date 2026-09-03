# Handover — URL restructure, round 2 (Caddy on questhub, plus one content move)

Server: SSH alias `questhub` (ControlMaster already open; plain `ssh questhub
'<cmd>'` works — do NOT run ssh-add or askpass setup). You own
`/etc/caddy/Caddyfile` for this task.

Back up before editing, `sudo caddy validate` before `sudo systemctl reload
caddy`, restore the backup if validate fails. You did the first round of this
restructure; this corrects and extends it.

## Owner's decisions to implement

1. **`idea2.site/web-of-trust/` becomes the project's front door.** It must
   serve what `evobiosys.org/web-of-trust/` used to serve. That content is on
   disk at `/srv/questhub-static/web-of-trust/` (19 KB index.html, title
   "Web of Trust — decentralized, trust-gated sharing for real, in-person
   community"). Copy it to a new dir for the idea2.site mount — do not move it
   out from under whatever else may still reference it.

   ⚠️ The owner described this page as **purple**, and it is green
   (`#9dc79a`, `#0f1a14`). The page at `/srv/questhub-static/evobiosys-org/systems/web-of-trust/`
   is the periwinkle/blue-purple one (`#8fa7d8`, `#33456b`, title "Web of Trust ·
   EvoBioSys", 39 KB). He identified the first as the homepage and the second as
   its subpage, which matches the site structure, so go with the green one — but
   say clearly in your report that the colour does not match his description, so
   he can correct it in one sentence if it is the wrong page.

2. **Redirects, all TEMPORARY (302). He explicitly asked to keep them
   temporary for now — do not promote anything to 301.**
   - `idea2.site/wot*` → `https://idea2.site/web-of-trust/`
   - `evobiosys.org/web-of-trust*` → `https://idea2.site/web-of-trust/`
     (this currently points at `idea2.site/wot{uri}` from round 1 — retarget it)
   - `evobiosys.org/systems/web-of-trust*` → `https://idea2.site/web-of-trust/`
   - `evobiosys.org/wot` and `evobiosys.org/s/wot` → `https://idea2.site/web-of-trust/`
     (round 1 left these alone pending a decision; the decision is: redirect)

3. **Get `questhub.eco` out of the user-facing surface.** The owner: "i prefer
   not to use questhub.eco if not necessary."
   - Serve the mobile-UI app at `app.idea2.site/wot/app/` from the existing
     content at `/srv/questhub-static/wot-app`.
     ⚠️ That build was made with `--base=/wot-app/`, so its asset URLs are
     absolute and will 404 under a different path. Do NOT just repoint the
     route and call it done — verify the page actually renders (fetch the HTML,
     read the script/link hrefs, and curl one of those asset URLs). If the
     base is wrong, say so and leave the old route working; rebuilding that app
     is the app stream's job, not yours.
   - `questhub.eco/wot-app*` → 302 to wherever it ends up on idea2.
   - Leave `questhub.eco/relay/*` exactly as it is. It is the live relay and it
     is meant to stay under the hood; `app.idea2.site/relay/*` already proxies
     to the same process for browsers.

4. **`app.idea2.site/wot/demo*` keeps serving `/srv/questhub-static/app-idea2-wot`.**
   The app stream is replacing the page content there; you change nothing about
   that route.

## Reminders that have already cost time today

- A new directory under `/srv/questhub-static` gets SELinux `var_t` and Caddy
  404s everything in it. `restorecon` does not fix it. Use
  `sudo chcon -R --reference=/srv/questhub-static/wot-app <newdir>` and confirm
  with `ls -dZ`.
- `handle_path` strips the prefix before `file_server` can canonicalise a
  missing trailing slash, so a bare mount root serves a broken page. You added
  explicit `redir` guards for this in round 1 — do the same for every new route.

## Verify before reporting, with actual status codes

- `https://idea2.site/web-of-trust/` and without the slash → 200 / redirect-to-slash
- `https://idea2.site/wot` and `https://idea2.site/wot/` → 302 to /web-of-trust/
- `https://evobiosys.org/web-of-trust/`, `/systems/web-of-trust/`, `/wot`, `/s/wot` → 302 to idea2
- `https://evobiosys.org/rebiosys/` → **200, must not break**
- `POST https://questhub.eco/relay/send` with `{"to":"did:peer:2.x"}` → **202, must not break**
- `POST https://app.idea2.site/relay/send` same body → **202, must not break**
- `https://app.idea2.site/wot/demo/` → 200
- the mobile-UI app at its new path → 200 AND its assets resolve (see 3 above)

## Report

Write `DEVLOG/result-report-url-round2.md`: the diff, the backup filename, the
full verification table, and the colour-mismatch flag from item 1. Summarise in
your reply. Do not commit to git.
