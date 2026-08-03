#!/bin/bash
# Starts the published production build on a Synology NAS (DSM).
#
# This is a *bash* script despite the .bat name — on Linux the extension is
# cosmetic, and the name was chosen to sit alongside START_PRD.bat. Run it with
# either:
#     bash /volume1/.../START_PRD_SYN.bat [port]
#     ./START_PRD_SYN.bat [port]        (after: chmod +x START_PRD_SYN.bat)
#
# Usage: START_PRD_SYN.bat [port]       (default port: 5200)
#
# Run it from inside the folder REBUILD_PUBLISH_ARM.bat (or REBUILD_PUBLISH.bat
# on an Intel NAS) published to — it expects server.js beside it.
#
# What this adds over the generic start_prd.sh, all of it DSM-specific:
#   * finds node when PATH is bare, which is how Task Scheduler and cron run
#   * loads .env itself, so MYHOMEBASE_DB is set no matter how it was launched
#   * binds 0.0.0.0 so the app is reachable from the LAN, not just the NAS
#   * checks the SQLite database path before starting, since a wrong volume path
#     is the usual reason a fresh deploy fails
#   * keeps the log from growing without bound

set -u

PORT_NUMBER="${1:-5200}"

case "$PORT_NUMBER" in
    -h|--help)
        echo "Usage: START_PRD_SYN.bat [port]   (default 5200)"
        exit 0
        ;;
esac

if ! printf '%s' "$PORT_NUMBER" | grep -qE '^[0-9]+$' || [ "$PORT_NUMBER" -lt 1 ] || [ "$PORT_NUMBER" -gt 65535 ]; then
    echo "Invalid port '$PORT_NUMBER'. Give a number between 1 and 65535." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

LOG_FILE="$SCRIPT_DIR/start_prd_syn_log.log"
MAX_LOG_BYTES=$((5 * 1024 * 1024))

# Keep one previous log rather than letting a boot-time task grow it forever.
if [ -f "$LOG_FILE" ]; then
    LOG_BYTES="$(wc -c <"$LOG_FILE" 2>/dev/null || echo 0)"
    if [ "$LOG_BYTES" -gt "$MAX_LOG_BYTES" ]; then
        mv -f "$LOG_FILE" "$LOG_FILE.1"
    fi
fi

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') | $*" >>"$LOG_FILE"
}

log "=== START_PRD_SYN.bat invoked for port $PORT_NUMBER (dir: $SCRIPT_DIR) ==="

if [ ! -f "server.js" ]; then
    log "ERROR: server.js not found in $SCRIPT_DIR."
    log "Run this from the folder REBUILD_PUBLISH_ARM.bat published to."
    echo "server.js not found in $SCRIPT_DIR — see $LOG_FILE" >&2
    exit 1
fi

# --- find node ---------------------------------------------------------------
# DSM's Task Scheduler and cron run with a minimal PATH that usually excludes
# the Node.js package, so look in the places Package Center installs it before
# giving up. Newest version first.
if ! command -v node >/dev/null 2>&1; then
    for CANDIDATE in \
        /usr/local/bin \
        /opt/bin \
        $(ls -d /var/packages/Node.js_v*/target/usr/local/bin 2>/dev/null | sort -r)
    do
        if [ -x "$CANDIDATE/node" ]; then
            PATH="$CANDIDATE:$PATH"
            export PATH
            log "Found node in $CANDIDATE (added to PATH)."
            break
        fi
    done
fi

if ! command -v node >/dev/null 2>&1; then
    log "ERROR: node is not on PATH and wasn't found in the usual DSM locations."
    log "Install Node.js from Package Center, or add its bin folder to PATH above."
    echo "node not found — see $LOG_FILE" >&2
    exit 1
fi

log "node $(node --version) at $(command -v node)"

# --- environment --------------------------------------------------------------
# Load .env here rather than relying on the runtime to find it: this script may
# be launched from anywhere, and a missing MYHOMEBASE_DB silently falls back to
# a data/ folder next to the app instead of the real database.
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$SCRIPT_DIR/.env"
    set +a
    log "Loaded .env"
else
    log "WARNING: no .env found. Copy .env.example to .env and set MYHOMEBASE_DB."
fi

# The standalone server binds to HOSTNAME; without this it can listen on
# localhost only, which looks "started" but is unreachable from the LAN.
export HOSTNAME="${HOSTNAME_OVERRIDE:-0.0.0.0}"
export NODE_ENV=production
export PORT="$PORT_NUMBER"

if [ -n "${MYHOMEBASE_DB:-}" ]; then
    DB_DIR="$(dirname "$MYHOMEBASE_DB")"
    if [ ! -d "$DB_DIR" ]; then
        log "ERROR: MYHOMEBASE_DB points at $MYHOMEBASE_DB but $DB_DIR does not exist."
        log "Check the volume path — a Windows path in .env won't resolve on the NAS."
        echo "Database folder $DB_DIR not found — see $LOG_FILE" >&2
        exit 1
    fi
    if [ ! -f "$MYHOMEBASE_DB" ]; then
        log "NOTE: $MYHOMEBASE_DB doesn't exist yet; run the migrations to create it."
    fi
    log "Database: $MYHOMEBASE_DB"
fi

# --- free the port ------------------------------------------------------------
# A process owned by another user (e.g. a Task Scheduler job running as root)
# won't show a PID to these tools unless we're root too, so try a
# non-interactive sudo first and fall back to running as ourselves.
SUDO=""
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    SUDO="sudo -n"
fi

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
    log "Killing process(es) $PIDS currently using port $PORT_NUMBER..."
    $SUDO kill -9 $PIDS 2>/dev/null || kill -9 $PIDS 2>/dev/null
    sleep 1
else
    log "No process listening on port $PORT_NUMBER (checked with: ${SUDO:-no sudo})."
fi

# --- start ---------------------------------------------------------------------
log "Starting server.js on ${HOSTNAME}:${PORT_NUMBER} ..."
echo "Starting MyHomeBase on port $PORT_NUMBER — logging to $LOG_FILE"

# Runs in the foreground so DSM Task Scheduler can track and stop it. To leave
# it running after an SSH session ends instead:
#     nohup bash START_PRD_SYN.bat 5200 >/dev/null 2>&1 &
exec node server.js >>"$LOG_FILE" 2>&1
