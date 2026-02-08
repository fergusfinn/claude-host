#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="fergus@gotenks"
REMOTE_DIR="/home/fergus/claude-host"
SERVICE_NAME="claude-host"
NODE_VERSION="23"

echo "==> Backing up server directory"
BACKUP_DIR="${REMOTE_DIR}.backup-$(date +%Y%m%d-%H%M%S)"
ssh "$REMOTE_HOST" "rsync -a --exclude node_modules --exclude .next $REMOTE_DIR/ $BACKUP_DIR/ && echo '  -> Backup: $BACKUP_DIR'"

echo "==> Syncing files to $REMOTE_HOST:$REMOTE_DIR"
rsync -avz --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude data \
  --exclude coverage \
  --exclude '*.db' \
  --exclude .git \
  --exclude tsconfig.tsbuildinfo \
  ./ "$REMOTE_HOST:$REMOTE_DIR/"

echo "==> Installing deps, building, and restarting service"
ssh "$REMOTE_HOST" bash -s <<'REMOTE_SCRIPT'
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 23 > /dev/null

cd /home/fergus/claude-host

echo "  -> npm install"
npm install --omit=dev

echo "  -> next build"
npx next build

# Set up systemd user service if it doesn't exist or has changed
mkdir -p ~/.config/systemd/user
SERVICE_FILE="$HOME/.config/systemd/user/claude-host.service"
NVM_NODE_DIR="$(dirname "$(which node)")"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Claude Host - web-based tmux session manager
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/fergus/claude-host
ExecStart=${NVM_NODE_DIR}/npx tsx server.ts
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=EXECUTOR_TOKEN=$(cat /home/fergus/.claude-host-executor-token 2>/dev/null)
Environment=PATH=${NVM_NODE_DIR}:/home/fergus/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable claude-host
systemctl --user restart claude-host

echo "  -> Waiting for service to start..."
sleep 2
if systemctl --user is-active --quiet claude-host; then
  echo "==> Deployed successfully. Running at http://gotenks:3000"
else
  echo "==> Service failed to start. Logs:"
  journalctl --user -u claude-host --no-pager -n 20
  exit 1
fi
REMOTE_SCRIPT
