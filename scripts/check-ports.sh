#!/usr/bin/env bash
set -euo pipefail

# Quick runtime smoke checks for port policy and service health.

PROD_PORTS=(4000 4001 4002)
DEV_RANGE_START=3000
DEV_RANGE_END=3999

UNITS=(
  bun-web-4000-reliverse.service
  bun-api-4001-reliverse.service
  bun-router-4002-reliverse-preview.service
)

HEALTH_URLS=(
  "http://127.0.0.1:4000/health"
  "http://127.0.0.1:4001/health"
  "http://127.0.0.1:4002/health"
  "https://reliverse.org/health"
  "https://api.reliverse.org/health"
)

say() { printf "%s\n" "$*"; }
ok() { printf "✅ %s\n" "$*"; }
warn() { printf "⚠️  %s\n" "$*"; }
err() { printf "❌ %s\n" "$*"; }

FAIL=0

say "== Ports listening in 3000-4999 =="
PORTS=$(ss -ltnH | awk '{print $4}' | sed -E 's/.*:([0-9]+)$/\1/' | awk '$1>=3000 && $1<=4999' | sort -n | uniq || true)
printf "%s\n" "${PORTS:-<none>}"

for p in "${PROD_PORTS[@]}"; do
  if grep -qx "$p" <<<"${PORTS:-}"; then
    ok "prod port $p is listening"
  else
    err "prod port $p is NOT listening"
    FAIL=1
  fi
done

if awk -v s="$DEV_RANGE_START" -v e="$DEV_RANGE_END" '($1>=s && $1<=e){found=1} END{exit found?0:1}' <<<"${PORTS:-}"; then
  warn "some dev-range ports ($DEV_RANGE_START-$DEV_RANGE_END) are listening"
else
  ok "no dev-range ports ($DEV_RANGE_START-$DEV_RANGE_END) are listening"
fi

say "\n== systemd user units =="
for u in "${UNITS[@]}"; do
  if systemctl --user is-active --quiet "$u"; then
    ok "$u is active"
  else
    err "$u is NOT active"
    FAIL=1
  fi
done

say "\n== Health checks =="
for url in "${HEALTH_URLS[@]}"; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)
  if [[ "$code" == "200" ]]; then
    ok "$url -> $code"
  else
    err "$url -> $code"
    FAIL=1
  fi
done

say "\n== Result =="
if [[ "$FAIL" -eq 0 ]]; then
  ok "all critical checks passed"
  exit 0
fi
err "some checks failed"
exit 1
