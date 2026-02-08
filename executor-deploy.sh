#!/usr/bin/env bash
set -euo pipefail

# Deploy an executor to a remote machine.
#
# Usage:
#   ./executor-deploy.sh <remote-host> <control-plane-url> <executor-token> [executor-name]
#
# Example:
#   ./executor-deploy.sh fergus@laptop ws://gotenks:3000 mytoken123 laptop
#
# The executor runs as a systemd user service and connects outbound to the
# control plane — no inbound ports needed on the executor machine.

REMOTE_HOST="${1:?Usage: $0 <remote-host> <control-plane-url> <executor-token> [executor-name]}"
CONTROL_PLANE_URL="${2:?Usage: $0 <remote-host> <control-plane-url> <executor-token> [executor-name]}"
EXECUTOR_TOKEN="${3:?Usage: $0 <remote-host> <control-plane-url> <executor-token> [executor-name]}"
EXECUTOR_NAME="${4:-$(echo "$REMOTE_HOST" | sed 's/.*@//')}"
REMOTE_DIR="/home/$(echo "$REMOTE_HOST" | sed 's/.*@//')/claude-host-executor"

echo "==> Deploying executor '${EXECUTOR_NAME}' to ${REMOTE_HOST}"
echo "    Control plane: ${CONTROL_PLANE_URL}"
echo "    Remote dir: ${REMOTE_DIR}"

# Only sync what the executor needs (no Next.js, no frontend)
echo "==> Syncing executor files..."
rsync -avz --delete \
  --include='executor/***' \
  --include='shared/***' \
  --include='lib/pty-bridge.ts' \
  --include='package.json' \
  --include='package-lock.json' \
  --include='tsconfig.json' \
  --include='hooks/***' \
  --exclude='*' \
  ./ "$REMOTE_HOST:$REMOTE_DIR/"

echo "==> Installing deps and configuring service"
ssh "$REMOTE_HOST" bash -s <<REMOTE_SCRIPT
set -euo pipefail

export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"
nvm use 23 > /dev/null 2>&1 || true

cd "${REMOTE_DIR}"

echo "  -> npm install"
npm install --omit=dev 2>&1 | tail -3

# Set up systemd user service
mkdir -p ~/.config/systemd/user
SERVICE_FILE="\$HOME/.config/systemd/user/claude-host-executor.service"
NVM_NODE_DIR="\$(dirname "\$(which node)")"

cat > "\$SERVICE_FILE" <<EOF
[Unit]
Description=Claude Host Executor - remote tmux session runner
After=network.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_DIR}
ExecStart=\${NVM_NODE_DIR}/npx tsx executor/index.ts --url ${CONTROL_PLANE_URL} --token ${EXECUTOR_TOKEN} --id ${EXECUTOR_NAME} --name "${EXECUTOR_NAME}"
Restart=on-failure
RestartSec=5
Environment=PATH=\${NVM_NODE_DIR}:\$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable claude-host-executor
systemctl --user restart claude-host-executor

echo "  -> Waiting for service to start..."
sleep 2
if systemctl --user is-active --quiet claude-host-executor; then
  echo "==> Executor '${EXECUTOR_NAME}' deployed and running"
else
  echo "==> Service failed to start. Logs:"
  journalctl --user -u claude-host-executor --no-pager -n 20
  exit 1
fi
REMOTE_SCRIPT
