#!/usr/bin/env bash
set -Eeuo pipefail

# Reliverse OS bootstrap preflight (read-only)
#
# Purpose:
# - verify that the machine is a sensible bootstrap target
# - classify the host as fresh / partially prepared / existing Reliverse-style host
# - surface missing prerequisites before any mutating bootstrap steps exist
#
# This script is intentionally conservative and non-destructive.

EXPECTED_OS_ID="ubuntu"
EXPECTED_OS_VERSION_PREFIX="24.04"
EXPECTED_HOSTNAME="${RELIVERSE_EXPECT_HOSTNAME:-}"
STRICT=0

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
INFO_COUNT=0

usage() {
  cat <<'EOF'
Usage: 00-preflight.sh [options]

Options:
  --expect-hostname <name>  Require a specific hostname.
  --strict                  Exit non-zero on warnings as well as failures.
  -h, --help                Show this help.

Environment:
  RELIVERSE_EXPECT_HOSTNAME  Alternative way to set expected hostname.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect-hostname)
      [[ $# -ge 2 ]] || { echo "missing value for --expect-hostname" >&2; exit 2; }
      EXPECTED_HOSTNAME="$2"
      shift 2
      ;;
    --strict)
      STRICT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_BLUE=$'\033[34m'
else
  C_RESET=''
  C_BOLD=''
  C_GREEN=''
  C_YELLOW=''
  C_RED=''
  C_BLUE=''
fi

section() {
  printf '\n%s== %s ==%s\n' "$C_BOLD" "$1" "$C_RESET"
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '%s[PASS]%s %s\n' "$C_GREEN" "$C_RESET" "$1"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  printf '%s[WARN]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '%s[FAIL]%s %s\n' "$C_RED" "$C_RESET" "$1"
}

info() {
  INFO_COUNT=$((INFO_COUNT + 1))
  printf '%s[INFO]%s %s\n' "$C_BLUE" "$C_RESET" "$1"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

safe_cmd() {
  local out
  if out=$("$@" 2>/dev/null); then
    printf '%s' "$out"
    return 0
  fi
  return 1
}

HOST_MODE="fresh"
HOST_ARTIFACTS=()

is_deploy_path() {
  local path="$1"
  [[ "$path" == "/home/deploy/"* || "$path" == "/home/deploy" ]]
}

path_exists_via_context() {
  local path="$1"
  if is_deploy_path "$path"; then
    sudo -n -u deploy python3 - <<'PY' "$path" >/dev/null 2>&1
from pathlib import Path
import sys
raise SystemExit(0 if Path(sys.argv[1]).exists() else 1)
PY
  else
    test -e "$path"
  fi
}

classify_host() {
  [[ -d /home/blefnk/dev ]] && HOST_ARTIFACTS+=("/home/blefnk/dev")
  [[ -d /home/deploy/prod ]] && HOST_ARTIFACTS+=("/home/deploy/prod")
  [[ -d /home/blefnk/.config/systemd/user ]] && HOST_ARTIFACTS+=("blefnk-user-units")
  [[ -d /home/deploy/.config/systemd/user ]] && HOST_ARTIFACTS+=("deploy-user-units")
  [[ -f /etc/ferron.kdl ]] && HOST_ARTIFACTS+=("/etc/ferron.kdl")
  path_exists_via_context /home/deploy/.config/bleverse/deploy.json && HOST_ARTIFACTS+=("deploy-registry")
  [[ -d /home/blefnk/.openclaw ]] && HOST_ARTIFACTS+=("openclaw-home")

  if (( ${#HOST_ARTIFACTS[@]} == 0 )); then
    HOST_MODE="fresh"
  elif (( ${#HOST_ARTIFACTS[@]} <= 2 )); then
    HOST_MODE="partial"
  else
    HOST_MODE="existing"
  fi
}

check_required_commands() {
  local missing=0
  local cmds=(bash curl git systemctl loginctl grep sed cp tee stat find id getent hostnamectl)
  for cmd in "${cmds[@]}"; do
    if have "$cmd"; then
      pass "command available: $cmd"
    else
      fail "missing required base command: $cmd"
      missing=1
    fi
  done
  return "$missing"
}

check_later_platform_commands() {
  local cmds=(bun openclaw ss)
  for cmd in "${cmds[@]}"; do
    if have "$cmd"; then
      pass "platform/helper command available: $cmd"
    else
      info "platform/helper command not present yet: $cmd"
    fi
  done
}

check_os() {
  if [[ ! -r /etc/os-release ]]; then
    fail "/etc/os-release missing; cannot verify operating system"
    return
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  local actual_id="${ID:-unknown}"
  local actual_version="${VERSION_ID:-unknown}"

  if [[ "$actual_id" == "$EXPECTED_OS_ID" ]]; then
    pass "OS family matches expected: $actual_id"
  else
    fail "expected OS family '$EXPECTED_OS_ID', got '$actual_id'"
  fi

  if [[ "$actual_version" == "$EXPECTED_OS_VERSION_PREFIX"* ]]; then
    pass "OS version matches expected baseline: $actual_version"
  else
    fail "expected OS version prefix '$EXPECTED_OS_VERSION_PREFIX', got '$actual_version'"
  fi
}

check_identity() {
  local host
  host=$(safe_cmd hostnamectl --static || safe_cmd hostname || echo unknown)
  info "current hostname: $host"

  if [[ -n "$EXPECTED_HOSTNAME" ]]; then
    if [[ "$host" == "$EXPECTED_HOSTNAME" ]]; then
      pass "hostname matches expected value: $EXPECTED_HOSTNAME"
    else
      fail "expected hostname '$EXPECTED_HOSTNAME', got '$host'"
    fi
  else
    info "no expected hostname provided; skipping strict hostname check"
  fi

  info "current user: $(id -un) (uid=$(id -u), gid=$(id -g))"
}

check_privilege_path() {
  if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
    pass "running as root"
    return
  fi

  if ! have sudo; then
    fail "not running as root and sudo is not available"
    return
  fi

  if sudo -n true >/dev/null 2>&1; then
    pass "full non-interactive sudo works"
  elif sudo -n -l >/dev/null 2>&1; then
    info "full non-interactive sudo is unavailable, but scoped sudo rules are present"
  else
    warn "sudo exists but requires a password or interactive prompt"
  fi
}

check_network() {
  local route_ok=0
  local dns_ok=0
  local https_ok=0

  if have ip && ip route get 1.1.1.1 >/dev/null 2>&1; then
    pass "basic outbound routing looks available"
    route_ok=1
  else
    warn "could not confirm outbound route via 'ip route get 1.1.1.1'"
  fi

  if getent hosts github.com >/dev/null 2>&1; then
    pass "DNS resolution works for github.com"
    dns_ok=1
  else
    warn "DNS resolution check failed for github.com"
  fi

  if curl -fsSI --max-time 5 https://github.com >/dev/null 2>&1; then
    pass "HTTPS egress check to github.com succeeded"
    https_ok=1
  else
    warn "HTTPS egress check to github.com failed"
  fi

  if (( route_ok == 0 && dns_ok == 0 && https_ok == 0 )); then
    fail "network preflight looks unhealthy overall"
  fi
}

check_host_classification() {
  classify_host
  info "host mode classification: $HOST_MODE"

  if (( ${#HOST_ARTIFACTS[@]} > 0 )); then
    info "detected host artifacts: ${HOST_ARTIFACTS[*]}"
  else
    info "no Reliverse-style host artifacts detected yet"
  fi

  case "$HOST_MODE" in
    fresh)
      pass "host looks suitable for first-time bootstrap"
      ;;
    partial)
      warn "host looks partially prepared; bootstrap should be migration-aware"
      ;;
    existing)
      info "host already contains strong Reliverse-style artifacts; do not treat this as a blind first-install target"
      ;;
  esac
}

check_user_model() {
  local users=(blefnk deploy)
  local user
  for user in "${users[@]}"; do
    if id "$user" >/dev/null 2>&1; then
      local shell home linger='unknown'
      shell=$(getent passwd "$user" | awk -F: '{print $7}')
      home=$(getent passwd "$user" | awk -F: '{print $6}')
      pass "user exists: $user"
      info "user $user -> home=$home shell=$shell"
      if have loginctl; then
        linger=$(loginctl show-user "$user" -p Linger 2>/dev/null | awk -F= '{print $2}')
        if [[ "$linger" == "yes" ]]; then
          pass "linger enabled for $user"
        elif [[ -n "$linger" ]]; then
          warn "linger not enabled for $user"
        else
          warn "could not determine linger state for $user"
        fi
      fi
    else
      if [[ "$HOST_MODE" == "fresh" ]]; then
        info "user not present yet (acceptable on fresh host): $user"
      else
        fail "expected user missing on non-fresh host: $user"
      fi
    fi
  done
}

check_canonical_paths() {
  local paths=(/home/blefnk/dev /home/deploy/prod /var/www)
  local path
  for path in "${paths[@]}"; do
    if [[ -e "$path" ]]; then
      pass "canonical path exists: $path"
    else
      if [[ "$HOST_MODE" == "fresh" ]]; then
        info "canonical path not present yet (acceptable before bootstrap): $path"
      else
        warn "canonical path missing on non-fresh host: $path"
      fi
    fi
  done
}

check_platform_state() {
  if path_exists_via_context /home/deploy/.config/bleverse/deploy.json; then
    pass "deploy registry present at /home/deploy/.config/bleverse/deploy.json"
  else
    info "deploy registry not present yet"
  fi

  if [[ -f /etc/ferron.kdl ]]; then
    pass "Ferron config present at /etc/ferron.kdl"
  else
    info "Ferron config not present yet"
  fi

  if have openclaw; then
    if openclaw status >/dev/null 2>&1; then
      pass "OpenClaw CLI responds successfully"
    else
      warn "OpenClaw CLI exists but 'openclaw status' did not succeed"
    fi
  fi
}

print_summary() {
  section "Summary"
  printf 'passes=%d warns=%d fails=%d infos=%d\n' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT" "$INFO_COUNT"
  printf 'host_mode=%s\n' "$HOST_MODE"

  if (( FAIL_COUNT > 0 )); then
    printf '%sRESULT: NOT READY%s\n' "$C_RED" "$C_RESET"
    return 1
  fi

  if (( WARN_COUNT > 0 )); then
    if (( STRICT == 1 )); then
      printf '%sRESULT: READY WITH WARNINGS (strict mode => non-zero)%s\n' "$C_YELLOW" "$C_RESET"
      return 2
    fi
    printf '%sRESULT: READY WITH WARNINGS%s\n' "$C_YELLOW" "$C_RESET"
    return 0
  fi

  printf '%sRESULT: READY%s\n' "$C_GREEN" "$C_RESET"
  return 0
}

main() {
  section "Reliverse OS Preflight"
  info "script: bootstrap/00-preflight.sh"
  info "mode: read-only"

  section "Base commands"
  check_required_commands || true
  check_later_platform_commands

  section "OS and identity"
  check_os
  check_identity

  section "Privilege path"
  check_privilege_path

  section "Network"
  check_network

  section "Host classification"
  check_host_classification

  section "User model"
  check_user_model

  section "Canonical paths"
  check_canonical_paths

  section "Platform state"
  check_platform_state

  print_summary
}

main "$@"
