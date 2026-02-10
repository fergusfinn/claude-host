#!/usr/bin/env bash
set -euo pipefail

# Setup script for running claude-host-executor as a launchd service on macOS.
# Can be run directly: curl -fsSL https://raw.githubusercontent.com/.../setup-mac.sh | bash -s -- --url ... --token ...
# Or from a cloned repo: ./executor/setup-mac.sh --url ... --token ...

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

# Clone or update the repo
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "==> Updating existing clone in $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "==> Cloning claude-host into $INSTALL_DIR"
  git clone https://github.com/fergusfinn/claude-host.git "$INSTALL_DIR"
fi

echo "==> Installing dependencies"
cd "$INSTALL_DIR" && npm install --omit=dev

# Find npx
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
PLIST_FILE="$HOME/Library/LaunchAgents/com.claude-host.executor.plist"

mkdir -p "$HOME/Library/LaunchAgents"

# Unload existing service if present
launchctl unload "$PLIST_FILE" 2>/dev/null || true

cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.claude-host.executor</string>
  <key>WorkingDirectory</key><string>${INSTALL_DIR}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NPX_PATH}</string>
    <string>tsx</string>
    <string>executor/index.ts</string>
    <string>--url</string><string>${URL}</string>
    <string>--token</string><string>${TOKEN}</string>
    <string>--name</string><string>${NAME}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/claude-host-executor.log</string>
  <key>StandardErrorPath</key><string>/tmp/claude-host-executor.log</string>
</dict>
</plist>
EOF

echo "==> Created $PLIST_FILE"

launchctl load "$PLIST_FILE"

echo ""
sleep 1
if launchctl list | grep -q com.claude-host.executor; then
  echo "==> Executor is running!"
  echo "    Logs:    tail -f /tmp/claude-host-executor.log"
  echo "    Stop:    launchctl unload $PLIST_FILE"
  echo "    Update:  git -C $INSTALL_DIR pull && launchctl unload $PLIST_FILE && launchctl load $PLIST_FILE"
else
  echo "==> Service may have failed to start."
  echo "    Check: launchctl list | grep claude-host"
  echo "    Logs:  cat /tmp/claude-host-executor.log"
fi
