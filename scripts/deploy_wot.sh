#!/usr/bin/env bash
#
# Deploy the whole Vertrauensnetz surface to its canonical homes.
#
#   idea2.site/web-of-trust/   the project's front door (server-side content)
#   idea2.site/wot             302 -> /web-of-trust/
#   app.idea2.site/wot/demo/   front door + demo overview    (apps/hub)
#   app.idea2.site/wot/demo1/  chat-group query, QR only     (apps/demo)
#   app.idea2.site/wot/demo2/  same, but over the relay       (apps/demo, VITE_WOT_MODE=relay)
#   app.idea2.site/wot/demo4/  full app mockup               (demos/app-mockup.html)
#   app.idea2.site/wot/demo5/  gating prototype              (demos/gating-prototype.html)
#   app.idea2.site/wot/app/    mobile-UI LAN alpha client    (apps/mobile-ui)
#
# questhub.eco stays under the hood: it hosts the relay process and nothing
# user-facing. app.idea2.site proxies /relay/* to it so the demo pages talk to
# one origin only.
#
# Two things this script exists to get right, both learned by breaking them:
#
#   1. Each app is built with an ABSOLUTE base matching its deploy path. With a
#      relative base, opening the page without its trailing slash resolves the
#      assets against the site root, everything 404s, and the page renders as a
#      silent black rectangle. See apps/demo/vite.config.ts.
#
#   2. A new directory under /srv/questhub-static gets SELinux context var_t,
#      and Caddy then serves 404 for everything inside it. restorecon does NOT
#      fix this -- the context has to be copied from a working sibling with
#      chcon --reference. This costs ten minutes every single time it is
#      forgotten.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_APP=/srv/questhub-static/app-idea2-wot
REF=/srv/questhub-static/wot-app   # a directory whose SELinux context is known good
SSHENV=(env SSH_ASKPASS="$HOME/.ssh/questhub-jump-askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0)

echo "... deploy_wot script running ..."
echo "--------"

rsh() { "${SSHENV[@]}" ssh questhub "$@"; }

# Push one local directory to one remote directory, then repair its context.
push_dir() {
  local src="$1" dest="$2"
  [ -d "$src" ] || { echo "missing source dir: $src" >&2; exit 1; }
  rsh "sudo mkdir -p $dest && sudo chown -R almalinux:almalinux $dest && rm -rf $dest/*"
  "${SSHENV[@]}" scp -q -r "$src"/* "questhub:$dest/"
  rsh "chmod -R a+rX $dest && sudo chcon -R --reference=$REF $dest"
  echo "  pushed  $(basename "$src") -> $dest"
}

# Push one local file as a directory's index.html.
push_page() {
  local src="$1" dest="$2"
  [ -f "$src" ] || { echo "missing source file: $src" >&2; exit 1; }
  rsh "sudo mkdir -p $dest && sudo chown -R almalinux:almalinux $dest && rm -rf $dest/*"
  "${SSHENV[@]}" scp -q "$src" "questhub:$dest/index.html"
  rsh "chmod -R a+rX $dest && sudo chcon -R --reference=$REF $dest"
  echo "  pushed  $(basename "$src") -> $dest/index.html"
}

echo "building and pushing demo1 (base /wot/demo1/, QR only)"
( cd "$REPO/apps/demo" && WOT_BASE=/wot/demo1/ npx vite build >/dev/null )
push_dir  "$REPO/apps/demo/dist"               "$REMOTE_APP/demo1"

# Demo 2 is the SAME app with the transport switched at build time, so it
# reuses dist/. Each build is pushed immediately, before the next overwrites it.
echo "building and pushing demo2 (base /wot/demo2/, over the relay)"
( cd "$REPO/apps/demo" && WOT_BASE=/wot/demo2/ VITE_WOT_MODE=relay npx vite build >/dev/null )
push_dir  "$REPO/apps/demo/dist"               "$REMOTE_APP/demo2"

# mobile-ui takes its base on the CLI (no base in its vite.config). It used to
# be built with --base=/wot-app/ and served from questhub.eco; those absolute
# asset paths are why it could not simply be re-routed onto idea2.
echo "building and pushing the mobile-ui app (base /wot/app/)"
( cd "$REPO/apps/mobile-ui" && npx vite build --base=/wot/app/ >/dev/null )
push_dir  "$REPO/apps/mobile-ui/dist"          "$REMOTE_APP/app"

echo "pushing the static pages"
push_dir  "$REPO/apps/hub"                     "$REMOTE_APP/demo"
push_page "$REPO/demos/app-mockup.html"        "$REMOTE_APP/demo4"
push_page "$REPO/demos/gating-prototype.html"  "$REMOTE_APP/demo5"

echo "--------"
echo "verifying (a 200 for each, with AND without the trailing slash)"
fail=0
for u in \
  "https://idea2.site/wot" \
  "https://app.idea2.site/wot/demo/" \
  "https://app.idea2.site/wot/demo" \
  "https://app.idea2.site/wot/demo1/" \
  "https://app.idea2.site/wot/demo1" \
  "https://app.idea2.site/wot/demo1/nachweis/" \
  "https://app.idea2.site/wot/demo2/" \
  "https://app.idea2.site/wot/demo2" \
  "https://app.idea2.site/wot/demo4/" \
  "https://app.idea2.site/wot/demo5/" \
  "https://app.idea2.site/wot/app/" \
  "https://app.idea2.site/wot/app" \
  "https://evobiosys.org/rebiosys/" ; do
  code=$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 20 "$u" || echo 000)
  printf '  %-46s %s\n' "$u" "$code"
  [ "$code" = "200" ] || fail=1
done

relay=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -X POST \
  https://app.idea2.site/relay/send -H 'content-type: application/json' \
  -d '{"to":"did:peer:2.deploycheck"}' || echo 000)
printf '  %-46s %s\n' "POST app.idea2.site/relay/send" "$relay"
[ "$relay" = "202" ] || fail=1

echo "--------"
if [ "$fail" = "0" ]; then
  echo "all good"
  echo "live: https://app.idea2.site/wot/demo/"
else
  echo "SOMETHING IS NOT 200 -- read the table above before demoing" >&2
  exit 1
fi
