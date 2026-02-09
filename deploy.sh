#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="fergus@gotenks"
REMOTE_DIR="/home/fergus/claude-host"
REPO_URL="https://github.com/fergusfinn/claude-host.git"

IS_LOCAL=false
if [ "$(hostname)" = "gotenks" ]; then
  IS_LOCAL=true
fi

# Ensure working tree is clean and push
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree is dirty. Commit or stash changes first."
  exit 1
fi

echo "==> Pushing to origin/main"
git push origin main

deploy() {
  set -euo pipefail

  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm use 23 > /dev/null

  REMOTE_DIR="/home/fergus/claude-host"
  REPO_URL="https://github.com/fergusfinn/claude-host.git"

  if [ ! -d "$REMOTE_DIR/.git" ]; then
    echo "  -> No git repo found — cloning"
    if [ -d "$REMOTE_DIR/data" ]; then
      mv "$REMOTE_DIR/data" /tmp/claude-host-data-backup
    fi
    rm -rf "$REMOTE_DIR"
    git clone "$REPO_URL" "$REMOTE_DIR"
    if [ -d /tmp/claude-host-data-backup ]; then
      mv /tmp/claude-host-data-backup "$REMOTE_DIR/data"
    fi
  else
    cd "$REMOTE_DIR"
    if [ -n "$(git status --porcelain)" ]; then
      echo "ERROR: Working tree on gotenks is dirty. Commit or stash changes first."
      git status --short
      exit 1
    fi
    echo "  -> Pulling latest"
    git pull --ff-only origin main
  fi

  cd "$REMOTE_DIR"

  echo "  -> npm install"
  npm install --omit=dev

  echo "  -> next build (to staging dir)"
  NEXT_DIST_DIR=".next-staging" npx next build

  # Atomic swap: stop service, swap build dirs, then start
  echo "  -> Swapping build output"
  systemctl --user stop claude-host 2>/dev/null || true
  rm -rf "$REMOTE_DIR/.next"
  mv "$REMOTE_DIR/.next-staging" "$REMOTE_DIR/.next"

  # Set up systemd user service
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
}

if [ "$IS_LOCAL" = true ]; then
  echo "==> Deploying locally on gotenks"
  deploy
else
  echo "==> Deploying on $REMOTE_HOST"
  # Export the function and run it over SSH
  ssh "$REMOTE_HOST" bash -s <<REMOTE_SCRIPT
$(declare -f deploy)
deploy
REMOTE_SCRIPT
fi
