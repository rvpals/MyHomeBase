#!/bin/sh
# Starts the published production build (server.js from the standalone
# output). Run this from inside the deployed folder that
# REBUILD_PUBLISH.bat published to.
#
# Usage: ./start_prd.sh [port]   (default port: 5200)

PORT_NUMBER="${1:-5200}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

LOG_FILE="$SCRIPT_DIR/start_prd_log.log"
echo "=== $(date) : start_prd.sh invoked for port $PORT_NUMBER ===" >>"$LOG_FILE"

if [ ! -f "server.js" ]; then
    echo "server.js not found in $SCRIPT_DIR." >>"$LOG_FILE"
    echo "Run this from the folder REBUILD_PUBLISH.bat published to." >>"$LOG_FILE"
    exit 1
fi

# Processes owned by another user (e.g. one Task Scheduler started as root)
# won't show a PID to netstat/ss/fuser/lsof unless we have root too, so try
# sudo first (non-interactively -- skip it rather than hang on a password
# prompt) and fall back to running as ourselves.
SUDO=""
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    SUDO="sudo -n"
fi

# Kill any process already listening on PORT_NUMBER so the server can bind cleanly.
PIDS=""
if command -v fuser >/dev/null 2>&1; then
    PIDS="$($SUDO fuser "${PORT_NUMBER}/tcp" 2>/dev/null | tr -d '[:space:]')"
elif command -v lsof >/dev/null 2>&1; then
    PIDS="$($SUDO lsof -ti tcp:"$PORT_NUMBER" 2>/dev/null | tr '\n' ' ')"
elif command -v ss >/dev/null 2>&1; then
    PIDS="$($SUDO ss -ltnp "sport = :$PORT_NUMBER" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u | tr '\n' ' ')"
elif command -v netstat >/dev/null 2>&1; then
    PIDS="$($SUDO netstat -ltnp 2>/dev/null | grep ":$PORT_NUMBER " | awk '{print $NF}' | cut -d/ -f1 | sort -u | tr '\n' ' ')"
fi

if [ -n "$PIDS" ]; then
    echo "Killing process(es) $PIDS currently using port $PORT_NUMBER..." >>"$LOG_FILE"
    $SUDO kill -9 $PIDS 2>/dev/null || kill -9 $PIDS 2>/dev/null
    sleep 1
else
    echo "No process found listening on port $PORT_NUMBER (checked with: ${SUDO:-no sudo})." >>"$LOG_FILE"
fi

export PORT="$PORT_NUMBER"
echo "=== $(date) : starting server.js on port $PORT_NUMBER ===" >>"$LOG_FILE"
exec node server.js >>"$LOG_FILE" 2>&1
