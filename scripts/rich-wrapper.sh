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

trap 'kill $CLAUDE_PID 2>/dev/null; exit 0' TERM
trap 'kill -INT $CLAUDE_PID 2>/dev/null' INT

# FIRST_RUN tracks whether this is the initial launch (for --fork-session support).
# On first run, CLAUDE_ARGS may contain --resume <id> --fork-session for forking.
# On restart, we strip those and use the discovered SESSION_ID instead.
FIRST_RUN=1

while true; do
  # Build command
  CMD=(claude)
  if [ "$FIRST_RUN" -eq 1 ]; then
    # First run: pass all args as-is (may include --resume + --fork-session)
    CMD+=("${CLAUDE_ARGS[@]}")
  else
    # Restart: strip --resume <value> and --fork-session from original args,
    # then use the discovered SESSION_ID instead
    SKIP_NEXT=""
    for arg in "${CLAUDE_ARGS[@]}"; do
      if [ "${SKIP_NEXT}" = "1" ]; then
        SKIP_NEXT=""
        continue
      fi
      if [ "$arg" = "--resume" ]; then
        SKIP_NEXT=1
        continue
      fi
      if [ "$arg" = "--fork-session" ]; then
        continue
      fi
      CMD+=("$arg")
    done
    if [ -n "$SESSION_ID" ]; then
      CMD+=(--resume "$SESSION_ID")
    fi
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
  # If interrupted by INT trap, re-wait so claude can flush its result event.
  wait $CLAUDE_PID 2>/dev/null || wait $CLAUDE_PID 2>/dev/null

  # Close fd 3
  exec 3>&-

  # Extract the most recent session_id from events for --resume
  SESSION_ID=$(grep -o '"session_id":"[^"]*"' "$EVENTS_FILE" 2>/dev/null \
    | tail -1 | cut -d'"' -f4)

  # After first run, strip --fork-session on subsequent restarts
  FIRST_RUN=0

  # Write restart marker so clients know claude is restarting
  echo '{"type":"system","subtype":"restart","message":"Claude process restarted"}' >> "$EVENTS_FILE"

  # Brief pause before restarting
  sleep 1
done
