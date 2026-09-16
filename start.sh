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

# The startup-failure fallback: a tiny server that holds port 3000 and serves
# app.log as an HTML page when the real app can't start. Without it a startup
# crash shows only DSM's generic "cannot connect", which says nothing about the
# cause, and reading the log meant SSH or SMB.
#
# Its PID lives in a SEPARATE file from app.pid on purpose. The "already up?"
# check below tests app.pid, so keeping them apart is what lets the fallback hold
# the port while this script still reads "the app is down" and keeps retrying. One
# shared PID file would make a crash-looping build look healthy forever — the
# fallback would be serving, the check would pass, and the app would never be
# started again.
FALLBACK_PIDFILE=$APP/fallback.pid
FALLBACK=$APP/startup-failure-server.cjs

# How long to give server.js to bind the port before calling the start failed.
# A Next standalone server on a DS223 (2 GB RAM, already swapping at idle) can
# take a while, so this is generous; a process that has already exited is detected
# immediately below rather than waiting this out.
START_TIMEOUT=20

# Stops the fallback so the real server can bind. Called before every start
# attempt: a fallback still holding port 3000 would cause EADDRINUSE and so become
# the very failure it exists to report.
stop_fallback() {
  if [ -f "$FALLBACK_PIDFILE" ]; then
    kill "$(cat "$FALLBACK_PIDFILE")" 2>/dev/null
    rm -f "$FALLBACK_PIDFILE"
    # It closes its listener on SIGTERM; give it a moment to actually release the port.
    sleep 1
  fi
}

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
#
# Clear any leftover fallback on the way out. The app being up means port 3000 is
# the app's, so a surviving fallback process is either already dead or failed to
# bind; either way its PID file is stale and would make the next stop_fallback
# signal an unrelated process that happened to inherit the number.
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  stop_fallback
  exit 0
fi

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
  # Captured rather than appended straight to app.log, because the deployment record wants
  # to know whether migrations ACTUALLY ran -- the runner exits 0 either way, so the exit
  # code cannot answer that. The output still reaches app.log below, unchanged.
  MIGRATE_OUTPUT=$(/usr/local/bin/node --env-file-if-exists="$APP/.env" "$APP/migrate.cjs" 2>&1)
  MIGRATE_STATUS=$?
  echo "$MIGRATE_OUTPUT" >> "$APP/app.log"
  if [ "$MIGRATE_STATUS" -ne 0 ]; then
    # Deliberately fatal: bringing up a build whose schema didn't land is how
    # you get a half-working app writing to a database it disagrees with. The
    # every-minute task will retry, and app.log says what broke.
    echo "$(date '+%Y-%m-%d %H:%M:%S') MIGRATION FAILED — not starting the app" >> "$APP/app.log"
    # Serve the reason on port 3000 too. This branch deliberately leaves the app
    # down, so without the fallback the only symptom is a reverse-proxy error and
    # the migration error stays unread in app.log -- the exact situation the
    # fallback exists for, and the one where the cause is already known.
    if [ -f "$FALLBACK" ]; then
      stop_fallback
      nohup /usr/local/bin/node "$FALLBACK" 3000 "$APP/app.log" >> "$APP/app.log" 2>&1 &
      echo $! > "$FALLBACK_PIDFILE"
    fi
    exit 1
  fi
  # A deploy with no schema change prints "No pending migrations." and must NOT be recorded
  # as having migrated -- otherwise the flag is 1 on every single deploy and says nothing.
  # Matching the runner's own wording is a little brittle, so the default is the safe one:
  # if that line ever changes, this reads as "migrated" on a deploy that didn't, rather
  # than hiding one that did.
  case "$MIGRATE_OUTPUT" in
    *"No pending migrations."*) ;;
    *) MIGRATED=1 ;;
  esac
fi

# Free the port before starting, in case a previous failure left the fallback up.
stop_fallback

export NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
nohup /usr/local/bin/node --env-file-if-exists="$APP/.env" "$APP/server.js" >> "$APP/app.log" 2>&1 &
APP_PID=$!
echo "$APP_PID" > "$PIDFILE"

# Did it actually come up?
#
# This used to end at the line above: `nohup ... &` followed by writing `$!` always
# "succeeds", because the shell reports the PID it forked whether or not the process
# survives a millisecond. A build that crashed on startup therefore looked exactly
# like a healthy one, the PID file named a dead process, and the only symptom was a
# reverse-proxy error page with the real reason sitting unread in app.log.
#
# Two things are checked, cheapest first, once a second:
#   * the process is still alive  — `kill -0`, a shell builtin; DSM has no pgrep
#   * something is listening on 3000 — it binds late, well after the fork
#
# A process that has already exited fails immediately rather than waiting out the
# full timeout, which is the common case for the failures this catches (a native
# module with the wrong Node ABI dies in well under a second).
STARTED=""
WAITED=0
while [ "$WAITED" -lt "$START_TIMEOUT" ]; do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    break
  fi
  # Is the port actually accepting connections yet?
  #
  # An real TCP connect, not a netstat scrape. Two reasons, and the second one is
  # why this isn't just simpler-looking:
  #   * It tests what actually matters -- that a client can connect -- rather than
  #     that a socket appears in a table.
  #   * Parsing netstat output is where the false positives live. A naive match on
  #     ":3000" also matches port 30001, and matches a *remote* :3000 in an
  #     ESTABLISHED row, either of which would report a dead app as healthy.
  #
  # Node is guaranteed present (it's what we just tried to launch), so this adds no
  # dependency. Falls back to netstat if the probe file is missing -- anchored on a
  # LISTEN row and a local address, which is what makes it safe.
  if [ -f "$APP/port-probe.cjs" ]; then
    if /usr/local/bin/node "$APP/port-probe.cjs" 3000 2>/dev/null; then
      STARTED=1
      break
    fi
  elif netstat -ltn 2>/dev/null \
    | grep -Eq '^tcp.*[:.]3000[[:space:]]+[0-9.:*]+[[:space:]]+LISTEN'; then
    STARTED=1
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if [ -z "$STARTED" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') app failed to start (waited ${WAITED}s) — serving the failure page" >> "$APP/app.log"
  # Reap the corpse if it's somehow still around, so it can't hold the port.
  kill "$APP_PID" 2>/dev/null
  rm -f "$PIDFILE"
  if [ -f "$FALLBACK" ]; then
    nohup /usr/local/bin/node "$FALLBACK" 3000 "$APP/app.log" >> "$APP/app.log" 2>&1 &
    echo $! > "$FALLBACK_PIDFILE"
  fi
  # Non-zero so a hand-run ./start.sh reports the failure. app.pid is gone, so the
  # every-minute keepalive task sees "down" and retries -- which is how a transient
  # failure (a port not yet released) recovers on its own.
  exit 1
fi

# Past here the app is up, so the steps below can safely touch the database.

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

# Log the deployment to sys_deployments, so the About screen can show a history with the
# build log the package carried in build-log.json. Gated on DEPLOYED for the same reason
# as the two steps above: a crash-restart is not a deployment and must not appear as one,
# or the history stops meaning anything.
#
# Here rather than in REBUILD_PUBLISH_NAS.bat for the same reason as the startup message:
# the batch file reaches the NAS only over SMB, and writing a live SQLite database across
# a network share risks corrupting it. Running here also means `deployed_at` is when the
# build actually went live, not when it finished building on Windows.
#
# --migrated is passed only when migrate.cjs really ran and succeeded above, so a recorded
# row distinguishes a schema change from a plain code deploy.
#
# The recorder never exits non-zero, so a failure can't stop the app coming up.
if [ "$DEPLOYED" = "1" ] && [ -f "$APP/record-deployment.cjs" ]; then
  /usr/local/bin/node --env-file-if-exists="$APP/.env" "$APP/record-deployment.cjs" \
    ${MIGRATED:+--migrated} >> "$APP/app.log" 2>&1
fi
