#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://reliverse.org}"

check() {
  local path="$1"
  local expect="$2"
  local body
  body=$(curl -fsS "${BASE_URL}${path}")
  echo "$body" | grep -q "$expect"
  echo "ok: ${path} contains '${expect}'"
}

check "/health" '"ok":true'
check "/" '<h1>Reliverse</h1>'
check "/about" 'About Reliverse'

echo "smoke: ok (${BASE_URL})"
