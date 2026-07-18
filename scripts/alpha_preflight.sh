#!/usr/bin/env bash
# alpha_preflight.sh — firewall/reachability preflight for `pnpm alpha`.
#
# Root cause this catches: the macOS Application Firewall (or LuLu) can hold
# a per-binary "block incoming" rule and/or stealth mode on. Node still binds
# 0.0.0.0 and answers fine on 127.0.0.1, but any connection to the machine's
# LAN IP (from the host itself, or a friend's phone) gets reset with no HTTP
# data — ERR_EMPTY_RESPONSE on the phone. This is NOT the "wrong IP baked
# into identity" issue (see ALPHA.md); the IP here is correct, the path to it
# is blocked. See ALPHA.md → Troubleshooting → "Phones can't connect /
# ERR_EMPTY_RESPONSE" for the human-facing pointer to this script.
#
# Usage: alpha_preflight.sh <HOST_IP> <PORT>
#   HOST_IP — the LAN IP the caller already detected (alpha_up.sh passes the
#             same $HOST_IP it printed above the join URLs; do not re-detect
#             it here — a second detection could disagree and confuse things).
#   PORT    — a port that should already be answering HTTP on HOST_IP. All
#             alpha_up.sh daemons + vite share the same node binary and the
#             same firewall rule, so probing one port (mobile-ui) is
#             representative — no need to also probe every persona port.
#
# Can be run standalone against any host/port, e.g. to sanity-check a
# throwaway `python3 -m http.server` before trusting this script.
#
# IMPORTANT: this preflight is diagnostic only and MUST be non-fatal. It
# always exits 0 — a false positive here (flaky curl, slow-starting server)
# must never stop `pnpm alpha` from printing join URLs that might actually
# work. set -e is deliberately NOT used for the same reason: curl exits
# nonzero on connection-refused even though -w still prints 000, and
# `sudo -n` exits nonzero (not a crash) when a password would be required.
set -u

HOST_IP="${1:-}"
PORT="${2:-}"

echo "… firewall/reachability preflight …"
echo "--------"

if [ -z "$HOST_IP" ] || [ -z "$PORT" ]; then
  echo "⚠️  usage: alpha_preflight.sh <HOST_IP> <PORT> — skipping (no target given)."
  echo "--------"
  exit 0
fi

# --- check 1: self-reachability over the LAN IP -----------------------------
lan_code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://${HOST_IP}:${PORT}/" 2>/dev/null || true)"
loopback_code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null || true)"

lan_ok=0
if [ -n "$lan_code" ] && [ "$lan_code" != "000" ] && printf '%s' "$lan_code" | grep -Eq '^[0-9]{3}$'; then
  lan_ok=1
fi
loopback_ok=0
if [ -n "$loopback_code" ] && [ "$loopback_code" != "000" ] && printf '%s' "$loopback_code" | grep -Eq '^[0-9]{3}$'; then
  loopback_ok=1
fi

if [ "$lan_ok" = 1 ]; then
  echo "✓ LAN reachability: http://${HOST_IP}:${PORT}/ -> ${lan_code}"
  echo "--------"
  echo "preflight: PASS (non-fatal check — continuing either way)."
  echo "--------"
  exit 0
fi

echo "⚠️  LAN reachability FAILED: http://${HOST_IP}:${PORT}/ -> '${lan_code:-000}' (no response / connection reset)"
if [ "$loopback_ok" = 1 ]; then
  echo "    localhost is fine: http://127.0.0.1:${PORT}/ -> ${loopback_code}"
  echo "    -> the server IS up; only the LAN path is blocked. This is the firewall signature below."
else
  echo "    localhost ALSO failed: http://127.0.0.1:${PORT}/ -> '${loopback_code:-000}'"
  echo "    -> the server itself may not be up yet (still starting, crashed, wrong port)."
  echo "       This may not be a firewall issue — check the server log before assuming firewall."
fi
echo "--------"

# --- check 2: macOS Application Firewall diagnosis (Darwin only) ------------
NODE_REAL=""
if [ "$(uname -s)" = "Darwin" ]; then
  echo "diagnosing macOS Application Firewall..."
  NODE_BIN="$(command -v node || true)"
  if [ -n "$NODE_BIN" ]; then
    if readlink -f "$NODE_BIN" >/dev/null 2>&1; then
      NODE_REAL="$(readlink -f "$NODE_BIN")"
    elif command -v python3 >/dev/null 2>&1; then
      NODE_REAL="$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$NODE_BIN" 2>/dev/null || true)"
    fi
    if [ -z "$NODE_REAL" ]; then
      NODE_REAL="$NODE_BIN"
    fi
  fi

  APPFW="/usr/libexec/ApplicationFirewall/socketfilterfw"
  if [ -n "$NODE_REAL" ]; then
    echo "  node binary: $NODE_REAL"
  else
    echo "  ⚠️  could not resolve node's binary path (node not on PATH?) — remediation commands below need it substituted manually."
  fi

  if [ -x "$APPFW" ]; then
    if [ -n "$NODE_REAL" ]; then
      if sudo -n true 2>/dev/null; then
        echo "  --getappblocked \"$NODE_REAL\":"
        sudo -n "$APPFW" --getappblocked "$NODE_REAL" 2>&1 | sed 's/^/    /'
      else
        echo "  ⚠️  sudo not available non-interactively (would prompt for a password)."
        echo "     run this yourself to check the app-specific block state:"
        echo "       sudo $APPFW --getappblocked \"$NODE_REAL\""
      fi
    fi
    echo "  --getglobalstate:"
    "$APPFW" --getglobalstate 2>&1 | sed 's/^/    /'
    echo "  --getstealthmode:"
    "$APPFW" --getstealthmode 2>&1 | sed 's/^/    /'
  else
    echo "  ⚠️  $APPFW not found (unexpected on macOS) — skipping firewall query."
  fi
  echo "--------"

  # --- check 3: remediation block --------------------------------------------
  echo "remediation:"
  if [ -n "$NODE_REAL" ]; then
    echo "  1. unblock node's incoming connections:"
    echo "       sudo $APPFW --unblockapp \"$NODE_REAL\""
    echo "  2. turn off stealth mode (broader — stealth silently drops probes too):"
    echo "       sudo $APPFW --setstealthmode off"
  else
    echo "  1. unblock node's incoming connections (substitute node's real path,"
    echo "     e.g. \`readlink -f \$(command -v node)\`):"
    echo "       sudo $APPFW --unblockapp \"<path-to-node>\""
    echo "  2. turn off stealth mode (broader — stealth silently drops probes too):"
    echo "       sudo $APPFW --setstealthmode off"
  fi
  echo "  3. or via GUI: System Settings -> Network -> Firewall -> Options... ->"
  echo "     allow incoming connections for node (or add it if not listed)."
  echo "  4. or, for the demo only: turn the Firewall off entirely in"
  echo "     System Settings -> Network -> Firewall."
  echo "  note: the block is keyed to the EXACT node binary path, including"
  echo "  version — a \`brew upgrade node\` or an nvm/volta version switch"
  echo "  changes that path and re-blocks the new one. Re-run this preflight"
  echo "  after upgrading node if phones stop connecting again."
  if command -v pgrep >/dev/null 2>&1 && pgrep -qi lulu 2>/dev/null; then
    echo "  LuLu (outbound firewall) is running on this host. It can ALSO reset"
    echo "  this preflight's own host->host curl to the LAN IP even when phones"
    echo "  connect fine, because that curl is outbound traffic LuLu inspects."
    echo "  -> allow node in LuLu, or pause LuLu, and re-run this preflight."
    echo "  -> if a phone can already load the app despite this warning, treat"
    echo "     this as a LuLu false positive on the host, not a real block."
  fi
  echo "--------"
else
  echo "⚠️  non-Darwin host — skipping macOS Application Firewall diagnosis."
  echo "  check your OS's firewall (ufw/firewalld/iptables/Windows Defender"
  echo "  Firewall) for a rule blocking incoming connections to node on port ${PORT}."
  echo "--------"
fi

echo "⚠️  preflight found a possible LAN block — CONTINUING ANYWAY (non-fatal;"
echo "   join URLs are printed below regardless — they may still work, e.g."
echo "   if this host-side self-test hit a LuLu false positive)."
echo "   See ALPHA.md -> Troubleshooting -> \"Phones can't connect / ERR_EMPTY_RESPONSE\"."
echo "--------"

exit 0
