#!/usr/bin/env bash
# One-shot migration: disable auth and reassign all sessions to 'local' user.
# Run on gotenks (or via SSH). Safe to run multiple times.
set -euo pipefail

DB="/home/fergus/claude-host/data/sessions.db"

if [ ! -f "$DB" ]; then
  echo "ERROR: Database not found at $DB"
  exit 1
fi

echo "==> Migrating session ownership to 'local'"
sqlite3 "$DB" <<'SQL'
UPDATE sessions SET user_id = 'local' WHERE user_id != 'local' OR user_id IS NULL;
UPDATE executors SET user_id = 'local' WHERE user_id != 'local' OR user_id IS NULL;
SQL

ROWS_SESSIONS=$(sqlite3 "$DB" "SELECT changes();")
echo "  -> Sessions migrated"

echo "==> Done. All sessions now owned by 'local'."
