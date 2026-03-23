#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-/home/deploy/.config/systemd/user}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$REPO_DIR/deploy/systemd"

mkdir -p "$TARGET_DIR"
cp "$SOURCE_DIR/bun-web-4020-reliverse-prod.service" "$TARGET_DIR/"
cp "$SOURCE_DIR/bun-api-4021-reliverse-prod.service" "$TARGET_DIR/"

echo "INSTALLED systemd unit templates into $TARGET_DIR"
echo "Next steps:"
echo "  systemctl --user daemon-reload"
echo "  systemctl --user restart bun-web-4020-reliverse-prod.service"
echo "  systemctl --user restart bun-api-4021-reliverse-prod.service"
