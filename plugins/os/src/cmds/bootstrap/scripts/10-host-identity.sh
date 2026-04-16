#!/usr/bin/env bash
set -Eeuo pipefail

# Reliverse OS bootstrap step 10: host identity baseline
#
# Scope:
# - hostname
# - canonical operator users
# - shell/home sanity
# - expected supplementary groups
# - lingering for user services
#
# Safety model:
# - dry-run by default
# - mutates only with --apply
# - conservative on existing users: warns on risky mismatches, fixes only low-risk identity items

APPLY=0
EXPECTED_HOSTNAME="${RELIVERSE_EXPECT_HOSTNAME:-reliverse-os}"
BLEFNK_USER="${RELIVERSE_BLEFNK_USER:-blefnk}"
DEPLOY_USER="${RELIVERSE_DEPLOY_USER:-deploy}"
BLEFNK_HOME="${RELIVERSE_BLEFNK_HOME:-/home/blefnk}"
DEPLOY_HOME="${RELIVERSE_DEPLOY_HOME:-/home/deploy}"
BLEFNK_SHELL="${RELIVERSE_BLEFNK_SHELL:-/usr/bin/zsh}"
DEPLOY_SHELL="${RELIVERSE_DEPLOY_SHELL:-/usr/bin/zsh}"

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
ACTION_COUNT=0

usage() {
  cat <<'EOF'
Usage: 10-host-identity.sh [options]

Options:
  --apply                    Perform mutations. Default is dry-run.
  --hostname <name>          Expected hostname (default: reliverse-os)
  --blefnk-user <name>       Dev/maintenance user (default: blefnk)
  --deploy-user <name>       Prod/runtime user (default: deploy)
  --blefnk-home <path>       Home path for blefnk user
  --deploy-home <path>       Home path for deploy user
  --blefnk-shell <path>      Login shell for blefnk user
  --deploy-shell <path>      Login shell for deploy user
  -h, --help                 Show this help.

Environment overrides:
  RELIVERSE_EXPECT_HOSTNAME
  RELIVERSE_BLEFNK_USER
  RELIVERSE_DEPLOY_USER
  RELIVERSE_BLEFNK_HOME
  RELIVERSE_DEPLOY_HOME
  RELIVERSE_BLEFNK_SHELL
  RELIVERSE_DEPLOY_SHELL

Notes:
  - dry-run by default
  - changing existing uid/gid/home ownership policy is intentionally conservative
  - this script does not create runtime/service files; it only establishes host identity basics
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --hostname)
      EXPECTED_HOSTNAME="$2"
      shift 2
      ;;
    --blefnk-user)
      BLEFNK_USER="$2"
      shift 2
      ;;
    --deploy-user)
      DEPLOY_USER="$2"
      shift 2
      ;;
    --blefnk-home)
      BLEFNK_HOME="$2"
      shift 2
      ;;
    --deploy-home)
      DEPLOY_HOME="$2"
      shift 2
      ;;
    --blefnk-shell)
      BLEFNK_SHELL="$2"
      shift 2
      ;;
    --deploy-shell)
      DEPLOY_SHELL="$2"
      shift 2
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
  printf '%s[INFO]%s %s\n' "$C_BLUE" "$C_RESET" "$1"
}

plan() {
  ACTION_COUNT=$((ACTION_COUNT + 1))
  if (( APPLY == 1 )); then
    printf '%s[APPLY]%s %s\n' "$C_BLUE" "$C_RESET" "$1"
  else
    printf '%s[PLAN]%s %s\n' "$C_BLUE" "$C_RESET" "$1"
  fi
}

have() {
  command -v "$1" >/dev/null 2>&1
}

run_as_root() {
  if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

require_apply_privilege() {
  if (( APPLY == 0 )); then
    return 0
  fi

  if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
    return 0
  fi

  if ! have sudo; then
    fail "--apply requested but sudo is unavailable"
    return 1
  fi

  if sudo -n true >/dev/null 2>&1 || sudo -n -l >/dev/null 2>&1; then
    return 0
  fi

  fail "--apply requested but non-interactive sudo privilege is unavailable"
  return 1
}

ensure_group_exists() {
  local group="$1"
  if getent group "$group" >/dev/null 2>&1; then
    pass "group exists: $group"
  else
    fail "required group missing: $group"
  fi
}

current_hostname() {
  hostnamectl --static 2>/dev/null || hostname
}

ensure_hostname() {
  local current
  current=$(current_hostname)
  info "current hostname: $current"

  if [[ "$current" == "$EXPECTED_HOSTNAME" ]]; then
    pass "hostname already correct: $EXPECTED_HOSTNAME"
    return
  fi

  plan "set hostname to $EXPECTED_HOSTNAME"
  if (( APPLY == 1 )); then
    run_as_root hostnamectl set-hostname "$EXPECTED_HOSTNAME"
    pass "hostname set to $EXPECTED_HOSTNAME"
  else
    warn "hostname differs from expected: current=$current expected=$EXPECTED_HOSTNAME"
  fi
}

ensure_user() {
  local user="$1"
  local home="$2"
  local shell="$3"
  local groups_csv="$4"

  if [[ ! -x "$shell" ]]; then
    fail "expected shell does not exist or is not executable for $user: $shell"
    return
  fi

  if ! id "$user" >/dev/null 2>&1; then
    plan "create user '$user' with home=$home shell=$shell groups=$groups_csv"
    if (( APPLY == 1 )); then
      run_as_root useradd -m -d "$home" -s "$shell" -G "$groups_csv" "$user"
      pass "created user: $user"
    else
      warn "user missing and would be created during apply: $user"
    fi
    return
  fi

  pass "user exists: $user"

  local current_home current_shell current_groups
  current_home=$(getent passwd "$user" | awk -F: '{print $6}')
  current_shell=$(getent passwd "$user" | awk -F: '{print $7}')
  current_groups=$(id -nG "$user" 2>/dev/null || true)

  info "$user -> home=$current_home shell=$current_shell groups=$current_groups"

  if [[ "$current_home" != "$home" ]]; then
    warn "$user home differs from expected (current=$current_home expected=$home); not changing automatically"
  else
    pass "$user home matches expected"
  fi

  if [[ "$current_shell" != "$shell" ]]; then
    plan "set login shell for $user to $shell"
    if (( APPLY == 1 )); then
      run_as_root usermod -s "$shell" "$user"
      pass "updated shell for $user"
    else
      warn "$user shell differs from expected (current=$current_shell expected=$shell)"
    fi
  else
    pass "$user shell matches expected"
  fi

  local group
  IFS=',' read -r -a groups <<< "$groups_csv"
  for group in "${groups[@]}"; do
    if id -nG "$user" | tr ' ' '\n' | grep -Fxq "$group"; then
      pass "$user already in supplementary group: $group"
    else
      plan "add $user to supplementary group: $group"
      if (( APPLY == 1 )); then
        run_as_root usermod -aG "$group" "$user"
        pass "added $user to group: $group"
      else
        warn "$user missing expected supplementary group: $group"
      fi
    fi
  done

  if [[ ! -d "$home" ]]; then
    plan "create missing home directory path for $user: $home"
    if (( APPLY == 1 )); then
      run_as_root mkdir -p "$home"
      run_as_root chown "$user:$user" "$home"
      pass "created missing home path for $user"
    else
      warn "expected home directory path missing for $user: $home"
    fi
  else
    pass "home path exists for $user: $home"
    local home_owner home_group home_mode
    home_owner=$(stat -c '%U' "$home" 2>/dev/null || true)
    home_group=$(stat -c '%G' "$home" 2>/dev/null || true)
    home_mode=$(stat -c '%a' "$home" 2>/dev/null || true)
    if [[ "$home_owner:$home_group" != "$user:$user" ]]; then
      plan "fix ownership for $home -> $user:$user"
      if (( APPLY == 1 )); then
        run_as_root chown "$user:$user" "$home"
        pass "fixed ownership for $home"
      else
        warn "home path ownership differs for $user (current=${home_owner}:${home_group} expected=${user}:${user})"
      fi
    else
      pass "home path ownership matches for $user"
    fi
    if [[ -n "$home_mode" && "$home_mode" != "700" && "$home_mode" != "750" && "$home_mode" != "755" ]]; then
      warn "home path mode is unusual for $user: $home_mode"
    fi
  fi
}

ensure_linger() {
  local user="$1"
  local current
  current=$( (loginctl show-user "$user" -p Linger 2>/dev/null || true) | awk -F= '{print $2}')
  if [[ "$current" == "yes" ]]; then
    pass "linger already enabled for $user"
    return
  fi

  plan "enable linger for $user"
  if (( APPLY == 1 )); then
    run_as_root loginctl enable-linger "$user"
    pass "enabled linger for $user"
  else
    warn "linger not enabled for $user"
  fi
}

summary() {
  section "Summary"
  printf 'mode=%s\n' "$([[ $APPLY -eq 1 ]] && echo apply || echo dry-run)"
  printf 'actions=%d passes=%d warns=%d fails=%d\n' "$ACTION_COUNT" "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"

  if (( FAIL_COUNT > 0 )); then
    printf '%sRESULT: NOT READY%s\n' "$C_RED" "$C_RESET"
    return 1
  fi

  if (( WARN_COUNT > 0 )); then
    printf '%sRESULT: READY WITH WARNINGS%s\n' "$C_YELLOW" "$C_RESET"
    return 0
  fi

  printf '%sRESULT: READY%s\n' "$C_GREEN" "$C_RESET"
  return 0
}

main() {
  section "Reliverse OS Host Identity"
  info "script: bootstrap/10-host-identity.sh"
  info "mode: $([[ $APPLY -eq 1 ]] && echo apply || echo dry-run)"

  section "Preconditions"
  require_apply_privilege || true
  ensure_group_exists users
  ensure_group_exists sudo

  section "Hostname"
  ensure_hostname

  section "Canonical users"
  ensure_user "$BLEFNK_USER" "$BLEFNK_HOME" "$BLEFNK_SHELL" "sudo,users"
  ensure_user "$DEPLOY_USER" "$DEPLOY_HOME" "$DEPLOY_SHELL" "users"

  section "Linger"
  if id "$BLEFNK_USER" >/dev/null 2>&1; then
    ensure_linger "$BLEFNK_USER"
  fi
  if id "$DEPLOY_USER" >/dev/null 2>&1; then
    ensure_linger "$DEPLOY_USER"
  fi

  summary
}

main "$@"
