#!/usr/bin/env bash
# alpha_up.sh — Task 8: one-command LAN alpha environment.
#
# Boots every persona's agent-daemon in one process (scripts/alpha_server.ts)
# plus the mobile-ui Vite dev server (--host 0.0.0.0), waits for both to come
# up, then prints each friend's join URL + a scannable QR code. Ctrl-C (or any
# exit) tears down both processes and verifies with `lsof` that nothing is
# left listening — see ALPHA.md's security box: this is a LAN-open, no-auth
# alpha environment, not something to leave running unattended.
set -u

echo "… alpha environment starting …"
echo "--------"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 1

PERSONAS_FILE="alpha/personas.json"
MOBILE_PORT="${ALPHA_MOBILE_PORT:-5173}"
HOST_IP="${HOST_IP:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)}"
export HOST_IP

if ! command -v jq >/dev/null 2>&1; then
  echo "MISS jq is required (brew1 install jq) — aborting."
  exit 1
fi
if [ ! -f "$PERSONAS_FILE" ]; then
  echo "MISS $PERSONAS_FILE not found — aborting."
  exit 1
fi

echo "host IP: $HOST_IP  (override with HOST_IP=x.x.x.x pnpm alpha)"
echo "mobile-ui port: $MOBILE_PORT"
echo "--------"

STATE_DIR="alpha/state"
mkdir -p "$STATE_DIR"
SERVER_LOG="$STATE_DIR/alpha_server.log"
MOBILE_LOG="$STATE_DIR/mobile_ui.log"

SERVER_PID=""
MOBILE_PID=""

# Runs "$@" in the background, kills it if it hasn't finished after $1 seconds.
# Portable stand-in for GNU `timeout` (not present on stock macOS).
run_with_timeout() {
  secs="$1"
  shift
  "$@" &
  cmd_pid=$!
  (sleep "$secs" && kill -9 "$cmd_pid" 2>/dev/null) &
  watcher_pid=$!
  wait "$cmd_pid" 2>/dev/null
  status=$?
  kill "$watcher_pid" 2>/dev/null
  wait "$watcher_pid" 2>/dev/null
  return $status
}

CLEANED_UP=""
cleanup() {
  # Re-entrancy guard: the INT/TERM trap runs this, and then bash runs the
  # EXIT trap again on the way out — without this guard the whole shutdown
  # sequence (including the lsof sweep) would print twice.
  if [ -n "$CLEANED_UP" ]; then
    return
  fi
  CLEANED_UP=1

  echo ""
  echo "… alpha environment shutting down …"
  echo "--------"

  for pid in "$MOBILE_PID" "$SERVER_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "stopping pid $pid..."
      kill "$pid" 2>/dev/null
    fi
  done

  # Give alpha_server.ts's SIGINT/SIGTERM handler (closes every daemon server
  # + SQLite store) and vite a moment to exit cleanly before force-killing.
  for _ in $(seq 1 20); do
    alive=0
    for pid in "$MOBILE_PID" "$SERVER_PID"; do
      [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && alive=1
    done
    [ "$alive" = 0 ] && break
    sleep 0.25
  done

  for pid in "$MOBILE_PID" "$SERVER_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "force-killing pid $pid..."
      kill -9 "$pid" 2>/dev/null
    fi
  done

  PORT_RANGE="4101-4106,${MOBILE_PORT}"
  echo "verifying no orphan listeners on ${PORT_RANGE}..."
  leftover="$(lsof -nP -iTCP:"$PORT_RANGE" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$leftover" ]; then
    echo "WARN orphan listener pid(s) found, force-killing: $leftover"
    # shellcheck disable=SC2086
    kill -9 $leftover 2>/dev/null
    sleep 0.5
  fi
  remaining="$(lsof -nP -iTCP:"$PORT_RANGE" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$remaining" ]; then
    echo "OK   no orphan listeners on ${PORT_RANGE}"
  else
    echo "MISS listener(s) still present:"
    echo "$remaining"
  fi
  echo "--------"
}
trap cleanup EXIT INT TERM

echo "starting agent daemons (alpha_server.ts, all personas in one process)..."
pnpm tsx scripts/alpha_server.ts >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
echo "  alpha_server pid=$SERVER_PID (log: $SERVER_LOG)"

echo "starting mobile-ui dev server on :$MOBILE_PORT..."
# NOTE: deliberately no "--" before these flags. `pnpm --filter <pkg> dev --
# --host ...` makes pnpm forward a LITERAL "--" into the underlying `vite`
# invocation (confirmed empirically against this repo's pnpm@10.33.0/vite@5.4
# pairing: the printed command becomes `vite -- --host ...`), and vite's CLI
# parser then treats everything after that "--" as raw passthrough rather
# than flags, so it silently ignores --host/--port. Omitting "--" here forwards
# the flags to vite directly and it binds 0.0.0.0:$MOBILE_PORT correctly.
pnpm --filter @resource-web/mobile-ui dev --host 0.0.0.0 --port "$MOBILE_PORT" >"$MOBILE_LOG" 2>&1 &
MOBILE_PID=$!
echo "  mobile-ui pid=$MOBILE_PID (log: $MOBILE_LOG)"
echo "--------"

echo "waiting for agent daemons to become ready..."
all_up=1
for port in $(jq -r '.[].port' "$PERSONAS_FILE"); do
  up=0
  for _ in $(seq 1 60); do
    if curl -sf -m 1 "http://127.0.0.1:${port}/api/state" >/dev/null 2>&1; then
      up=1
      break
    fi
    sleep 0.5
  done
  if [ "$up" = 1 ]; then
    echo "  OK   port $port"
  else
    echo "  MISS port $port did not come up within 30s (see $SERVER_LOG)"
    all_up=0
  fi
done
if [ "$all_up" = 0 ]; then
  echo "WARN not all agent daemons came up — check $SERVER_LOG. Continuing anyway."
fi

echo "waiting for mobile-ui dev server to become ready..."
mobile_up=0
for _ in $(seq 1 60); do
  if curl -sf -m 1 "http://127.0.0.1:${MOBILE_PORT}/" >/dev/null 2>&1; then
    mobile_up=1
    break
  fi
  sleep 0.5
done
if [ "$mobile_up" = 1 ]; then
  echo "  OK   port $MOBILE_PORT"
else
  echo "  MISS port $MOBILE_PORT did not come up within 30s (see $MOBILE_LOG)"
fi
echo "--------"

echo "join URLs (same WiFi required):"
echo "--------"
jq -c '.[]' "$PERSONAS_FILE" | while read -r row; do
  key="$(echo "$row" | jq -r '.key')"
  name="$(echo "$row" | jq -r '.name')"
  port="$(echo "$row" | jq -r '.port')"
  app="$(echo "$row" | jq -r '.app')"
  url="http://${HOST_IP}:${MOBILE_PORT}/?agent=http://${HOST_IP}:${port}&app=${app}&persona=${key}"
  echo "${name}  (app=${app}, port=${port})"
  echo "  ${url}"
  if command -v npx >/dev/null 2>&1; then
    if ! run_with_timeout 5 npx --yes qrcode-terminal "$url"; then
      echo "  (QR unavailable within 5s — npx qrcode-terminal not cached/reachable; use the URL above)"
    fi
  else
    echo "  (npx not found — QR skipped; use the URL above)"
  fi
  echo ""
done
echo "--------"
echo "alpha environment ready. Ctrl-C to stop everything (agent daemons + mobile-ui)."
echo "logs: $SERVER_LOG , $MOBILE_LOG"
echo "--------"

wait
