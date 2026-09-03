# Result — URL restructure on questhub (Caddy only)

Executed 2026-09-03. Server: questhub (ov-18b91e.infomaniak.ch, AlmaLinux 10).

## Backups

- `/etc/caddy/Caddyfile.bak.20260903_063701` — before the handover's own edits (step 1-6).
- `/etc/caddy/Caddyfile.bak.20260903_063957` — before the owner's amendment edits (steps below).

Restore either with `sudo cp <backup> /etc/caddy/Caddyfile && sudo systemctl reload caddy`.

## Caddyfile diff (backup → live, full and final)

```diff
--- /etc/caddy/Caddyfile.bak.20260903_063701
+++ /etc/caddy/Caddyfile
@@ -229,13 +229,21 @@
 		file_server
 	}
 
-	# --- web-of-trust demo hub (added 2026-09-03) ---
-	# Overview page linking every built demo. Same origin as /relay/* on
-	# purpose: the relay sends no CORS headers, so any demo page that talks
-	# to it must be served from questhub.eco itself.
+	# --- web-of-trust demo hub: redirected off questhub.eco, 2026-09-03 ---
+	# Owner amendment: questhub.eco must stay "under the hood" only (relays);
+	# the public brand is idea2.site, so /demos* here now redirects to the
+	# overview at app.idea2.site/wot/demo/ instead of serving it directly.
+	# CAUTION left for the app-build stream: the block this replaces noted
+	# the demo hub was deliberately same-origin with /relay/* below because
+	# the relay sends no CORS headers -- a demo page's fetch()/WS calls to
+	# /relay/* only worked because both were questhub.eco. Once the demo
+	# hub is reached via app.idea2.site instead, those relay calls become
+	# cross-origin and will fail without the relay adding CORS headers (or
+	# the demo being pointed at a same-origin relay proxy). This redirect
+	# does not fix that -- it is a Caddy routing change only; flagged in
+	# DEVLOG/result-report-url-restructure.md for the owner/app stream.
 	handle_path /demos* {
-		root * /srv/questhub-static/wot-demos
-		file_server
+		redir https://app.idea2.site/wot/demo/ temporary
 	}
 
 	# --- web-of-trust standalone mediator relay (added 2026-07-18) ---
@@ -423,9 +431,6 @@
 		try_files {path} {path}/ /index.html
 		file_server
 	}
-	handle_path /wot* {
-		redir https://idea2.site/web-of-trust/
-	}
 	handle_path /weboftrust* {
 		redir https://idea2.site/web-of-trust/
 	}
@@ -658,8 +663,19 @@
 		root * /srv/questhub-static/web-of-trust
 		file_server
 	}
+	# idea2.site/wot* -- web-of-trust apps, restructured 2026-09-03. Previously
+	# shadowed by a redir to /web-of-trust/ (removed) plus this duplicate root
+	# pointing at the old /srv/questhub-static/wot (also removed as dead).
+	# The bare mount root ("/wot", no subpath, no trailing slash) is a gap
+	# file_server's own canonicalization doesn't cover: handle_path strips
+	# the whole prefix before file_server sees the request, so "/wot" looks
+	# like an already-canonical "/" to file_server and gets served directly
+	# -- same bug class as the phone incident on /wot-demo (relative asset
+	# paths resolve against the wrong base without the trailing slash).
+	@wot_bare path /wot
+	redir @wot_bare /wot/ 308
 	handle_path /wot* {
-		root * /srv/questhub-static/wot
+		root * /srv/questhub-static/idea2-wot
 		file_server
 	}
 	# ST Coach: bridges to the real Infomaniak VPS now that its firewall is open
@@ -725,6 +741,17 @@
 	handle @uh {
 		reverse_proxy localhost:3001
 	}
+	# web-of-trust demos, added 2026-09-03. Single prefix over a directory
+	# tree (demo/, demo1/ ... demo5/) rather than one handle_path per demo,
+	# so new demos are just new directories -- no Caddyfile edit needed.
+	# Same bare-mount-root canonicalization gap as idea2.site/wot (see its
+	# comment) -- guarded here too even though the root has no index today.
+	@wot_bare path /wot
+	redir @wot_bare /wot/ 308
+	handle_path /wot* {
+		root * /srv/questhub-static/app-idea2-wot
+		file_server
+	}
 	handle / {
 		redir * /unlocking-housing/ temporary
 	}
@@ -838,6 +865,24 @@
 			file_server
 		}
 
+		# web-of-trust URL restructure, 2026-09-03: apps move to idea2.site/wot;
+		# evobiosys.org/web-of-trust becomes a redirect stub. Temporary (302),
+		# not permanent, while the destination directories are still empty --
+		# upgrade to permanent once content lands and the new URLs are verified.
+		# Scope: only /web-of-trust* (the app landing page, "Live demos, code,
+		# and how it works"). Deliberately NOT touched: /wot, /systems/web-of-trust,
+		# /s/wot -- those are short links into the separate systems-catalogue
+		# narrative page ("Permission-gated data-querying... explained and
+		# demonstrated"), different content, still working; redirecting them
+		# here would send real content to a currently-empty directory. Flagged
+		# for the project owner in the result report instead of guessed at.
+		handle_path /web-of-trust/draft-prototype* {
+			redir https://app.idea2.site/wot/demo/ temporary
+		}
+		handle_path /web-of-trust* {
+			redir https://idea2.site/wot{uri} temporary
+		}
+
 		# /pitch has no index page on live (its /pitch/ target itself 404s) so it
 		# can't be caught by the generic file-existence redirect below; GitHub
 		# Pages still 301s the bare path, so replicate that explicitly.
```

## Directories created

- `/srv/questhub-static/idea2-wot` (empty)
- `/srv/questhub-static/app-idea2-wot/{demo,demo1,demo2,demo3,demo4,demo5}` (empty)

Both chcon'd `-R --reference=/srv/questhub-static/wot-app` → `httpd_sys_content_t`, chowned `almalinux:almalinux`, chmod `a+rX`. Verified with `ls -dZ` (see test 9 below) — all `httpd_sys_content_t`, not `var_t`.

## What I chose differently from the handover, and why

1. **Untangling idea2.site's duplicate `/wot*`**: removed the shadowing `redir` block entirely and repurposed the (previously dead) `handle_path /wot* { root /srv/questhub-static/wot }` block in place — changed its root to `/srv/questhub-static/idea2-wot` — rather than deleting both and writing a third, new block. Net effect is identical to "remove both, add one clean block"; smaller diff.

2. **Bare-mount-root trailing-slash gap (not in the handover, found during verification):** `handle_path` strips the whole `/wot` prefix before `file_server` ever sees the request, so a bare `/wot` (no subpath, no trailing slash) looked like an already-canonical `/` to `file_server` and was served directly at 200 instead of redirecting — the same bug class that caused the original phone incident on `/wot-demo`. `file_server`'s own directory-redirect logic *did* work correctly for subpaths (`/wot/demo`, `/wot/demo1` → 308 to the slashed form, confirmed with `Location: /wot/demo/`, prefix intact — no double-strip problem there). Added a top-level `redir @wot_bare /wot/ 308` guard ahead of the `handle_path` (Caddy's directive order runs `redir` before `handle_path` regardless of file position) on both `idea2.site` and `app.idea2.site`. Confirmed fixed (test 5 below).

3. **evobiosys.org "other Web-of-Trust paths" — scoped down from what the handover's wording implied.** evobiosys.org actually has four wot-ish paths, not one:
   - `/web-of-trust/` — real content, meta title "Web of Trust · EvoBioSys", description "*Live demos, code, and how it works*" → clearly the app landing page. **Redirected** to `idea2.site/wot{uri}`.
   - `/web-of-trust/draft-prototype/` — a `noindex` mockup subpage. **Redirected** specifically to `app.idea2.site/wot/demo/` (the demo overview) rather than a path-preserved `idea2.site/wot/...` URL that wouldn't exist in the new app — this is the "demo overview where that is the better target" case the handover invited judgement on.
   - `/wot`, `/s/wot` — both are meta-refresh short links, and both point at `/systems/web-of-trust/`, **not** at `/web-of-trust/`. `/systems/web-of-trust/` is a separate, currently-working narrative/catalogue page (description: "*Permission-gated data-querying and information sharing... explained and demonstrated*"), different content from the app landing page, apparently a different publishing pipeline (owned by `root`, not `almalinux`, unlike everything else in that tree). **Left untouched** — redirecting a working page to a currently-empty directory would be a regression, not a fix, and nothing in the handover named these three paths specifically. Flagged below as a decision for the project owner.

4. **Redirect type: `temporary` (302), not `permanent` (301), on all the evobiosys.org and questhub.eco redirects.** The destination directories are empty by design (another stream fills them later) and this is a staged rollout — the file already carries this exact precedent in its own comments (the ST-Coach block: a 302 "won't get stuck cached in visitors' browsers in the meantime"). Noted in-line in the Caddyfile that these are upgradeable to `permanent` once content lands and the new URLs are verified.

## Amendment (received mid-task, folded in)

1. **`questhub.eco/demos*` now redirects** (302) to `https://app.idea2.site/wot/demo/` instead of serving `/srv/questhub-static/wot-demos` directly, per "questhub.eco must be under the hood only." `/relay/*` untouched — verified still 202 after every reload (five separate checks across this session).

2. **Other user-facing questhub.eco entry point found and left alone:** `handle_path /wot-app/* { root /srv/questhub-static/wot-app }` on questhub.eco — the existing mobile-ui static app (added 2026-07-18), served directly, not redirected. Not named in the amendment (which named only `/demos*`), and not part of the original handover's target structure either, so I did not touch it — flagged below rather than guessed at.

3. **CORS/relay risk on the `/demos*` redirect itself:** the code comment I replaced explicitly documented that the demo hub was kept same-origin with `/relay/*` on purpose, because the relay sends no CORS headers. Moving the demo hub's public URL to `app.idea2.site` makes any demo page's calls back to the relay cross-origin; they will fail unless the relay is made to send CORS headers or the demo is pointed at a same-origin relay proxy. **This is a Caddy routing change only — I did not touch relay code or CORS behavior (out of scope, and the relay itself was explicitly off-limits).** Flagged as a decision below.

## idea2.site "fails when typed directly, works via a link" — investigation (server-side only, no fixes attempted)

Checked and found **nothing broken server-side**:
- DNS: `idea2.site`, `www.idea2.site`, `app.idea2.site`, `evobiosys.org`, `questhub.eco` all resolve (A only, no AAAA anywhere — consistent across all of them, not specific to idea2.site) to `83.228.207.220`. TTL 69s on the apex — short but not abnormal.
- TLS: each of `idea2.site`, `www.idea2.site`, `app.idea2.site` has its own valid, current Let's Encrypt cert (single-SAN each, not a combined multi-SAN cert, which is normal for Caddy's default automatic HTTPS) — none expiring soon (earliest Oct 11 2026), none missing.
- HTTP→HTTPS: bare apex, `www.`, and `app.` all correctly 308-redirect to their HTTPS form.
- No `www.app.idea2.site` typo-domain exists (NXDOMAIN) that a phone autocomplete could catch a user on.
- HSTS header absent on both `idea2.site` and `app.idea2.site` — symmetric, not a differentiator, and absence doesn't cause failures (only forgoes forced-https caching).
- TLS handshake + TTFB from here: consistently ~200-280ms across 5 tries, no anomalies.

One thing I did **not** rule out and can't test from here: every response on every one of these domains advertises `alt-svc: h3=":443"` (HTTP/3 over QUIC/UDP). A phone that has cached that Alt-Svc header from a previous visit will attempt a QUIC/UDP handshake on the next direct navigation; if the mobile network or carrier throttles/blocks UDP/443 (common enough on cellular networks and some public wifi), that attempt can stall before falling back to TCP — while a link opened through another app's in-app browser, without that cached preference, goes straight to TCP/TLS and works. This is a plausible client-network-side explanation, not a confirmed one (⚠️ confidence ~0.4 — I have no way to reproduce carrier-level UDP behavior from this session). It is not a server misconfiguration to fix; it would require either disabling HTTP/3 in Caddy globally (`servers { protocols h1 h2 }`) or living with it. **Not something I touched** — reporting only, as instructed.

**Honest bottom line: nothing server-side found that explains the failure.** DNS/TLS/redirect setup is symmetric and correct across idea2.site and app.idea2.site.

## Full verification (all curl'd fresh after final reload)

| Check | Result |
|---|---|
| `evobiosys.org/rebiosys/` | **200** ✅ (hard constraint) |
| `questhub.eco/relay/send` POST `{"to":"did:peer:2.x"}` | **202** ✅ (hard constraint) |
| `app.idea2.site/` | 302 → `/unlocking-housing/` ✅ unchanged |
| `idea2.site/wot-demo/` | **200** ✅ old demo unaffected |
| `idea2.site/wot` (no slash) | 308 → `/wot/` ✅ |
| `app.idea2.site/wot` (no slash) | 308 → `/wot/` ✅ |
| `app.idea2.site/wot/demo` (no slash, tested with temp `index.html`) | 308 → `/wot/demo/`, prefix intact ✅ |
| `app.idea2.site/wot/demo1` (no slash, temp `index.html`) | 308 → `/wot/demo1/` ✅ |
| `idea2.site/wot/` (empty dir) | 404 — expected |
| `app.idea2.site/wot/demo/` (empty dir) | 404 — expected |
| `questhub.eco/demos`, `/demos/`, `/demos/foo` | 302 → `https://app.idea2.site/wot/demo/` ✅ |
| `evobiosys.org/web-of-trust/` | 302 → `https://idea2.site/wot/` |
| `evobiosys.org/web-of-trust/draft-prototype/mockup` | 302 → `https://app.idea2.site/wot/demo/` |
| `evobiosys.org/wot/` | 200 (untouched, still → systems/web-of-trust content) |
| `evobiosys.org/systems/web-of-trust/` | 200 (untouched) |
| `evobiosys.org/s/wot` | 301 → `/s/wot/` (untouched) |
| SELinux context, all 8 new dirs | `httpd_sys_content_t` ✅ (`ls -dZ`, confirmed, not `var_t`) |
| `caddy validate` | Valid configuration, both edit passes |
| `systemctl is-active caddy` | active, both reloads |
| `journalctl -u caddy` after reload | only pre-existing, unrelated ACME failures for `museum.idea2.life` and `www.app.unlocking-housing.org` (NXDOMAIN on those two, unrelated domains, not touched this session) |

Temp `index.html` files (content `ok`) used for the trailing-slash proof were created and deleted on `idea2-wot/`, `app-idea2-wot/demo/`, `app-idea2-wot/demo1/`; confirmed dirs empty again afterward.

## Decisions needed

- `/wot` and `/s/wot` on evobiosys.org currently alias to `/systems/web-of-trust/` (a separate narrative/catalogue page, not the app). Should these two short links be repointed into the new `idea2.site/wot` app, stay pointed at the narrative page as they are now, or be retired? Left untouched pending your call.
- `questhub.eco/wot-app/*` (the existing mobile-ui static app) is still served directly from questhub.eco, not redirected — the amendment named only `/demos*`. Does this also need to move off questhub.eco per "no user-facing entry point should be a questhub.eco URL," or is it intentionally staying (e.g. because mobile-ui's `relay=` param needs same-origin `/relay/*`, same reasoning as the demo-hub CORS issue below)?
- The `/demos*` → `app.idea2.site` redirect breaks same-origin access to `/relay/*` for any demo page that calls the relay directly (no CORS headers on the relay). This needs either CORS headers added to the relay, or the demo pointed at a same-origin relay proxy on `app.idea2.site` — application-level work, outside what I own here (Caddy routing only, relay explicitly off-limits).
- idea2.site direct-typing failure: no server-side cause found. The one untested hypothesis (HTTP/3/QUIC over a UDP-hostile mobile network) isn't something I can fix or confirm from here — flagging only, per your instruction not to touch DNS.
