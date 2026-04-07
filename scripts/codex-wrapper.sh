#!/usr/bin/env bash
# codex-wrapper.sh — runs inside a tmux session to keep codex exec alive.
#
# Usage: codex-wrapper.sh <events-file> <fifo-path> [codex-args...]
#
# Reads JSON prompts from the FIFO (one per line), invokes `codex exec --json`
# for each prompt. Codex's NDJSON output is piped through codex-normalize.mjs
# to translate events into Claude-compatible format, then appended to events file.
# Between turns, waits for the next prompt on the FIFO.

set -u

EVENTS_FILE="$1"
FIFO_PATH="$2"
shift 2
CODEX_ARGS=("$@")

# Create FIFO if it doesn't exist
[ -p "$FIFO_PATH" ] || mkfifo "$FIFO_PATH"
touch "$EVENTS_FILE"

SESSION_ID=""

# Locate the normalizer script (same repo as this script)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NORMALIZER="$SCRIPT_DIR/../executor/codex-normalize.mjs"

trap 'kill $CODEX_PID 2>/dev/null; exec 3>&-; exit 0' TERM
trap 'kill -INT $CODEX_PID 2>/dev/null' INT

# Open FIFO read-write (fd 3) so it stays open even when no writer is connected.
# Keep it open across the entire loop so writers never see ENXIO between prompts.
exec 3<>"$FIFO_PATH"

while true; do
  # Wait for a prompt line from the FIFO
  if ! IFS= read -r line <&3; then
    sleep 0.5
    continue
  fi

  # Parse the prompt text from the JSON wrapper.
  # Input format: {"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
  # Use node (available via bash -l PATH) for reliable JSON parsing.
  PROMPT_TEXT=$(printf '%s' "$line" | node -e "
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      try{const m=JSON.parse(d);const t=m.message?.content?.find(b=>b.type==='text');process.stdout.write(t?.text||'')}
      catch(e){process.stdout.write(d)}
    });
  ")

  if [ -z "$PROMPT_TEXT" ]; then
    continue
  fi

  # Build codex command
  CMD=(codex exec --json)
  CMD+=("${CODEX_ARGS[@]}")

  # Resume if we have a session ID from previous turn
  if [ -n "$SESSION_ID" ]; then
    CMD+=(resume "$SESSION_ID")
  fi

  # Add the prompt as the final argument
  CMD+=("$PROMPT_TEXT")

  # Run codex, pipe through normalizer (plain .mjs — no transpiler needed),
  # tee to events file
  "${CMD[@]}" 2>/dev/null \
    | node "$NORMALIZER" \
    | tee -a "$EVENTS_FILE" &
  CODEX_PID=$!

  # Wait for codex to exit
  wait $CODEX_PID 2>/dev/null || wait $CODEX_PID 2>/dev/null

  # Extract the thread/session ID from events for resume
  # The normalizer emits "session_id" (from the raw codex "thread_id")
  NEW_SESSION_ID=$(grep -o '"session_id":"[^"]*"' "$EVENTS_FILE" 2>/dev/null \
    | tail -1 | cut -d'"' -f4)
  if [ -n "$NEW_SESSION_ID" ]; then
    SESSION_ID="$NEW_SESSION_ID"
  fi

  # Brief pause before waiting for next prompt
  sleep 0.2
done
