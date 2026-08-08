#!/bin/sh
APP=/volume1/app/myhomebase
PIDFILE=$APP/app.pid
cd "$APP" || exit 1
# Already up? kill -0 is a shell builtin, unlike pgrep/ps on DSM.
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then exit 0; fi
export NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
nohup /usr/local/bin/node --env-file-if-exists="$APP/.env" "$APP/server.js" >> "$APP/app.log" 2>&1 &
echo $! > "$PIDFILE"
