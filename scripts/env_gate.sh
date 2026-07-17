#!/usr/bin/env bash
# M0 environment gate (§7.1). podman substitutes docker (DECISIONS.md D3).
set -u
echo "… env gate running …"
echo "--------"
ok=1
check() { if eval "$2" >/dev/null 2>&1; then echo "OK   $1"; else echo "MISS $1"; ok=0; fi }
check "container runtime (podman|docker)" "command -v podman || command -v docker"
check "compose" "podman compose version || docker compose version"
check "node >= 20" "node -e 'process.exit(parseInt(process.versions.node)>=20?0:1)'"
check "pnpm" "command -v pnpm"
check "git" "command -v git"
check "make" "command -v make"
if curl -s -m 3 "${OLLAMA_URL:-http://localhost:11434}/api/tags" >/dev/null 2>&1; then
  echo "OK   ollama reachable (LLM path live)"
else
  echo "WARN ollama unreachable — keyword fallback keeps the demo alive (§9)"
fi
echo "--------"
[ "$ok" = 1 ] && echo "gate: PASS" || { echo "gate: FAIL"; exit 1; }
