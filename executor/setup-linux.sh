#!/usr/bin/env bash
set -euo pipefail

# Setup script for running claude-host-executor as a systemd user service on Linux.
# Can be run directly: curl -fsSL https://raw.githubusercontent.com/.../setup-linux.sh | bash -s -- --url ... --token ...
# Or from a cloned repo: ./executor/setup-linux.sh --url ... --token ...

URL=""
TOKEN=""
NAME="Claude Host Executor"
INSTALL_DIR="$HOME/claude-host-executor"

while [[ $# -gt 0 ]]; do
  case $1 in
    --url) URL="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$URL" ] || [ -z "$TOKEN" ]; then
  echo "Usage: $0 --url <ws://host:port> --token <chk_...> [--name <name>] [--dir <install-dir>]"
  exit 1
fi

# Validate prerequisites
MISSING=""
command -v git >/dev/null 2>&1 || MISSING="$MISSING git"
command -v node >/dev/null 2>&1 || { export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; command -v node >/dev/null 2>&1 || MISSING="$MISSING node"; }
command -v tmux >/dev/null 2>&1 || MISSING="$MISSING tmux"
command -v claude >/dev/null 2>&1 || MISSING="$MISSING claude"
if [ -n "$MISSING" ]; then
  echo "ERROR: Missing required tools:$MISSING"
  echo "Install them before running this script."
  exit 1
fi

# Clone or update the repo
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "==> Updating existing clone in $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "==> Cloning claude-host into $INSTALL_DIR"
  git clone https://github.com/fergusfinn/claude-host.git "$INSTALL_DIR"
fi

echo "==> Installing dependencies"
cd "$INSTALL_DIR" && npm install --omit=dev --force

# Ensure ~/.config is writable (some cloud images have it owned by root)
if [ -d "$HOME/.config" ] && [ ! -w "$HOME/.config" ]; then
  echo "~/.config exists but is not writable — fixing ownership with sudo"
  sudo chown -R "$(id -u):$(id -g)" "$HOME/.config"
fi

mkdir -p "$HOME/.config/systemd/user"

# Find node/npx — check nvm, then PATH
NPX_PATH="$(command -v npx 2>/dev/null || true)"
if [ -z "$NPX_PATH" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  NPX_PATH="$(command -v npx 2>/dev/null || true)"
fi

if [ -z "$NPX_PATH" ]; then
  echo "ERROR: npx not found. Install Node.js first."
  exit 1
fi

NODE_BIN_DIR="$(dirname "$NPX_PATH")"
TMUX_BIN_DIR="$(dirname "$(command -v tmux)")"
CLAUDE_BIN_DIR="$(dirname "$(command -v claude)")"

SERVICE_FILE="$HOME/.config/systemd/user/claude-host-executor.service"
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Claude Host Executor - ${NAME}
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NPX_PATH} tsx executor/index.ts --url ${URL} --token ${TOKEN} --name "${NAME}"
Restart=on-failure
RestartSec=5
Environment=PATH=${NODE_BIN_DIR}:${TMUX_BIN_DIR}:${CLAUDE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

echo "==> Created $SERVICE_FILE"

# Enable lingering so user services run without an active login session
loginctl enable-linger "$(whoami)" 2>/dev/null || sudo loginctl enable-linger "$(whoami)" 2>/dev/null || true

systemctl --user daemon-reload
systemctl --user enable --now claude-host-executor

echo ""
sleep 1
if systemctl --user is-active --quiet claude-host-executor; then
  echo "==> Executor is running!"
  echo "    Status:  systemctl --user status claude-host-executor"
  echo "    Logs:    journalctl --user -u claude-host-executor -f"
  echo "    Stop:    systemctl --user stop claude-host-executor"
  echo "    Update:  git -C $INSTALL_DIR pull && systemctl --user restart claude-host-executor"
else
  echo "==> Service failed to start. Check logs:"
  journalctl --user -u claude-host-executor --no-pager -n 20
  exit 1
fi
