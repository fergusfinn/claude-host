#!/usr/bin/env bash
# rich-wrapper.sh — runs inside a tmux session to keep claude -p alive.
#
# Usage: rich-wrapper.sh <events-file> <fifo-path> [claude-args...]
#
# Reads JSON prompts from the FIFO (one per line), pipes them to claude's
# stdin. Claude's stdout (NDJSON events) is appended to the events file.
# If claude exits, it is automatically restarted with --resume.

set -u

EVENTS_FILE="$1"
FIFO_PATH="$2"
shift 2
CLAUDE_ARGS=("$@")

# Create FIFO if it doesn't exist
[ -p "$FIFO_PATH" ] || mkfifo "$FIFO_PATH"
touch "$EVENTS_FILE"

SESSION_ID=""

trap 'kill $CLAUDE_PID 2>/dev/null; exit 0' TERM INT

while true; do
  # Build command — add --resume if we have a session ID from a previous run
  CMD=(claude "${CLAUDE_ARGS[@]}")
  if [ -n "$SESSION_ID" ]; then
    CMD+=(--resume "$SESSION_ID")
  fi

  # Open FIFO read-write (fd 3) so it stays open even when no writer is connected.
  # This prevents blocking on open and allows multiple sequential writes.
  exec 3<>"$FIFO_PATH"

  # Start claude: feed it lines from fd 3, tee stdout to the events file
  "${CMD[@]}" < <(while IFS= read -r line <&3; do echo "$line"; done) \
    2>/dev/null \
    | tee -a "$EVENTS_FILE" &
  CLAUDE_PID=$!

  # Wait for claude to exit (crash, context exhaustion, etc.)
  wait $CLAUDE_PID 2>/dev/null

  # Close fd 3
  exec 3>&-

  # Extract the most recent session_id from events for --resume
  SESSION_ID=$(grep -o '"session_id":"[^"]*"' "$EVENTS_FILE" 2>/dev/null \
    | tail -1 | cut -d'"' -f4)

  # Write restart marker so clients know claude is restarting
  echo '{"type":"system","subtype":"restart","message":"Claude process restarted"}' >> "$EVENTS_FILE"

  # Brief pause before restarting
  sleep 1
done
