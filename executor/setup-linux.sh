#!/usr/bin/env bash
set -euo pipefail

# Setup script for running claude-host-executor as a systemd user service on Linux.
# Usage: ./executor/setup-linux.sh --url <ws://host:port> --token <chk_...> --name "My Executor"

URL=""
TOKEN=""
NAME="Claude Host Executor"

while [[ $# -gt 0 ]]; do
  case $1 in
    --url) URL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$URL" ] || [ -z "$TOKEN" ]; then
  echo "Usage: $0 --url <ws://host:port> --token <chk_...> [--name <name>]"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Ensure ~/.config is writable (some cloud images have it owned by root)
if [ -d "$HOME/.config" ] && [ ! -w "$HOME/.config" ]; then
  echo "~/.config exists but is not writable — fixing ownership with sudo"
  sudo chown -R "$(id -u):$(id -g)" "$HOME/.config"
fi

mkdir -p "$HOME/.config/systemd/user"

# Find node/npx — check nvm, then PATH
NPX_PATH="$(command -v npx 2>/dev/null || true)"
if [ -z "$NPX_PATH" ]; then
  # Try sourcing nvm
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  NPX_PATH="$(command -v npx 2>/dev/null || true)"
fi

if [ -z "$NPX_PATH" ]; then
  echo "ERROR: npx not found. Install Node.js first."
  exit 1
fi

NODE_BIN_DIR="$(dirname "$NPX_PATH")"

SERVICE_FILE="$HOME/.config/systemd/user/claude-host-executor.service"
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Claude Host Executor - ${NAME}
After=network.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
ExecStart=${NPX_PATH} tsx executor/index.ts --url ${URL} --token ${TOKEN} --name "${NAME}"
Restart=on-failure
RestartSec=5
Environment=PATH=${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

echo "Created $SERVICE_FILE"

# Enable lingering so user services run without an active login session
loginctl enable-linger "$(whoami)" 2>/dev/null || sudo loginctl enable-linger "$(whoami)" 2>/dev/null || true

systemctl --user daemon-reload
systemctl --user enable --now claude-host-executor

echo ""
sleep 1
if systemctl --user is-active --quiet claude-host-executor; then
  echo "Executor is running. Check status with: systemctl --user status claude-host-executor"
  echo "View logs with: journalctl --user -u claude-host-executor -f"
else
  echo "Service failed to start. Check logs:"
  journalctl --user -u claude-host-executor --no-pager -n 20
  exit 1
fi
