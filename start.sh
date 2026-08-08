#!/bin/sh
# Keeps MyHomeBase running on the Synology, and picks up new builds.
#
# One script, three jobs, because DSM's Task Scheduler is the only supervisor
# available without Docker:
#   * Boot-up task      — start it
#   * Every-minute task — restart it if it died
#   * After a publish   — restart it into the new build
#
# The third is what `deploy.trigger` is for. REBUILD_PUBLISH_NAS.bat drops that
# file into the app folder over SMB after copying, and the next scheduled run
# sees it and cycles the process. That means a release needs no SSH at all: run
# the batch file on Windows and the NAS switches over on its own.
#
# Copied to the NAS once by hand — deliberately NOT shipped by the publish, so a
# republish can't clobber the file the boot task runs, or strip its +x bit.

APP=/volume1/app/myhomebase
PIDFILE=$APP/app.pid
TRIGGER=$APP/deploy.trigger

cd "$APP" || exit 1

# A publish is waiting. Stop the old build; the start below brings up the new
# one. The trigger is removed first so a failure to stop can't wedge this into
# restarting on every run.
if [ -f "$TRIGGER" ]; then
  rm -f "$TRIGGER"
  echo "$(date '+%Y-%m-%d %H:%M:%S') deploy trigger seen — restarting" >> "$APP/app.log"
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    # Give it a moment to release port 3000 before the new one binds.
    sleep 3
  fi
  rm -f "$PIDFILE"
fi

# Already up? `kill -0` is a shell builtin — DSM has no pgrep.
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then exit 0; fi

export NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
nohup /usr/local/bin/node --env-file-if-exists="$APP/.env" "$APP/server.js" >> "$APP/app.log" 2>&1 &
echo $! > "$PIDFILE"
