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
# the batch file on Windows and the NAS switches over on its own — including
# applying any pending migrations, which used to be a hand-run SSH step and was
# therefore the one part of a release that could silently be skipped.
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
  DEPLOYED=1
fi

# Already up? `kill -0` is a shell builtin — DSM has no pgrep.
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then exit 0; fi

# Apply pending migrations after a publish — the old process is stopped by here
# and the new one hasn't bound yet, which is the only safe window: a schema
# change against a live database risks a locked write, and starting the new
# build first would serve new code against the old schema (which is exactly how
# a release once shipped a screen that answered "no such column").
#
# Same reasoning as the startup message below: this runs on the NAS, where the
# write is local to the database file. REBUILD_PUBLISH_NAS.bat reaches the NAS
# only over SMB, and migrating a live SQLite database across a network share
# risks corrupting it. Doing it here is also what keeps a release SSH-free.
#
# `migrate.cjs` takes its own timestamped backup first, records what it applied
# in sys_schema_migrations, and prints "No pending migrations." when there's
# nothing to do — so running it on every deploy is safe and near-free.
#
# Gated on DEPLOYED so a crash-restart never migrates: a new schema should
# arrive with a new build, not because the process happened to die.
if [ "$DEPLOYED" = "1" ] && [ -f "$APP/migrate.cjs" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') applying pending migrations" >> "$APP/app.log"
  if ! /usr/local/bin/node --env-file-if-exists="$APP/.env" "$APP/migrate.cjs" \
      >> "$APP/app.log" 2>&1; then
    # Deliberately fatal: bringing up a build whose schema didn't land is how
    # you get a half-working app writing to a database it disagrees with. The
    # every-minute task will retry, and app.log says what broke.
    echo "$(date '+%Y-%m-%d %H:%M:%S') MIGRATION FAILED — not starting the app" >> "$APP/app.log"
    exit 1
  fi
fi

export NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
nohup /usr/local/bin/node --env-file-if-exists="$APP/.env" "$APP/server.js" >> "$APP/app.log" 2>&1 &
echo $! > "$PIDFILE"

# Announce the new build on the home screen — but only after a publish, never
# after a crash-restart, which isn't a deployment and shouldn't claim to be.
#
# This runs here rather than in REBUILD_PUBLISH_NAS.bat on purpose: the batch
# file reaches the NAS only over SMB, and writing a live SQLite database across
# a network share risks corrupting it. Here the write is local to the running
# app. It also means the timestamp is when the build actually went live.
#
# The setter never exits non-zero, so a failure can't stop the app coming up.
if [ "$DEPLOYED" = "1" ] && [ -f "$APP/set-startup-message.cjs" ]; then
  /usr/local/bin/node --env-file-if-exists="$APP/.env" "$APP/set-startup-message.cjs" \
    >> "$APP/app.log" 2>&1
fi
