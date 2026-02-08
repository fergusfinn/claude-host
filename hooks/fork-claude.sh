#!/usr/bin/env bash
# Fork hook for Claude Code
# Reads the conversation session ID stored by claude-host in the tmux
# environment and outputs a `claude --resume <id> --fork-session` command.
#
# Environment variables provided by claude-host:
#   SOURCE_SESSION  - tmux session name
#   SOURCE_CWD      - working directory of the source pane
#   SOURCE_COMMAND   - original command (e.g. "claude", "claude --model opus")

set -euo pipefail

SESSION_ID=$(tmux show-environment -t "$SOURCE_SESSION" CLAUDE_SESSION_ID 2>/dev/null \
  | sed 's/^CLAUDE_SESSION_ID=//' || true)

if [[ -n "$SESSION_ID" && "$SESSION_ID" != "-CLAUDE_SESSION_ID" ]]; then
  echo "claude --resume $SESSION_ID --fork-session"
else
  # No tracked session ID — start fresh
  echo "$SOURCE_COMMAND"
fi
