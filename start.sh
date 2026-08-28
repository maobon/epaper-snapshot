#!/bin/sh

set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/start.log"
PID_FILE="$LOG_DIR/start.pid"

mkdir -p "$LOG_DIR"

if [ -f "$PID_FILE" ]; then
  EXISTING_PID=$(cat "$PID_FILE")

  case "$EXISTING_PID" in
    ''|*[!0-9]*)
      rm -f "$PID_FILE"
      ;;
    *)
      if kill -0 "$EXISTING_PID" 2>/dev/null; then
        echo "The project is already running. Process ID: $EXISTING_PID"
        echo "Log file: $LOG_FILE"
        exit 0
      fi

      rm -f "$PID_FILE"
      ;;
  esac
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm was not found. Install it and ensure it is available in PATH." >&2
  exit 1
fi

cd "$PROJECT_DIR"

{
  echo
  echo "[$(date '+%Y-%m-%d %H:%M:%S %z')] Starting the project"
} >>"$LOG_FILE"

nohup pnpm start >>"$LOG_FILE" 2>&1 </dev/null &
PID=$!
echo "$PID" >"$PID_FILE"

sleep 1

if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "The project failed to start. Check the log file: $LOG_FILE" >&2
  exit 1
fi

echo "The project has started in the background. Process ID: $PID"
echo "Log file: $LOG_FILE"
echo "Process ID file: $PID_FILE"
