@echo off
setlocal enabledelayedexpansion
REM Builds MyHomeBase for the Synology NAS (aarch64) and publishes it over the
REM SMB share.
REM
REM Usage: REBUILD_PUBLISH_NAS.bat [destination]
REM        (destination defaults to NAS_PATH below)
REM
REM Never touches data\, .env, start.sh, app.log or app.pid in the destination
REM -- a republish refreshes the app only, not the live database, the production
REM secrets, or the launcher the NAS boots from.
REM
REM Unlike REBUILD_PUBLISH.bat this does NOT run migrations: the destination is
REM a Linux box and the migration runner has to execute there, not here. The
REM command to run is printed at the end.

REM ===========================================================================
REM Destination. Edit this to match your NAS share.
REM   /volume1/app/myhomebase  is published by DSM as  \\NAS_DS223\app\myhomebase
REM ===========================================================================
set "NAS_PATH=\\NAS_DS223\app\myhomebase"

REM A command-line argument wins, so a second NAS or a dry run into a local
REM folder needs no edit here.
if not "%~1"=="" set "NAS_PATH=%~f1"

REM Strip a trailing backslash so the path concatenates predictably below.
if "%NAS_PATH:~-1%"=="\" set "NAS_PATH=%NAS_PATH:~0,-1%"

REM Run everything from the repo root regardless of caller's cwd.
cd /d "%~dp0"

set "STAGING=%~dp0dist-nas"

if not exist "%NAS_PATH%\" (
    echo Cannot reach "%NAS_PATH%".
    echo.
    echo   - Is the NAS powered on and on the network?
    echo   - Is the shared folder mounted / accessible in Explorer?
    echo   - Windows may need credentials: open \\NAS_DS223 in Explorer once
    echo     and tick "Remember my credentials".
    exit /b 1
)

echo === Building aarch64 deployment package ===
REM publish:nas does a clean build, then: materialises Windows symlinks that
REM would be dead on Linux, swaps in the arm64 better-sqlite3 prebuild and
REM verifies every copy really is an AArch64 ELF, strips the data\ and .env
REM that Next traces into the build output, and bundles the migration runner
REM to plain CJS so the NAS needs no tsx. It rebuilds dist-nas from scratch,
REM so there is never anything stale in staging.
call npm run publish:nas
if errorlevel 1 (
    echo BUILD FAILED. Aborting publish.
    exit /b 1
)

if not exist "%STAGING%\server.js" (
    echo "%STAGING%\server.js" not found. The build did not produce a package.
    exit /b 1
)

echo.
echo === Publishing to "%NAS_PATH%" ===
REM The trigger is written BEFORE the copy, not after. This looks wrong and is
REM deliberate -- writing it afterwards caused a real outage on 2026-08-30.
REM
REM Turbopack loads server chunks LAZILY: a page bundle resolves
REM `R.c("server/chunks/ssr/<hash>.js")` on the first request to that route, not
REM at boot. So between the copy landing and the keepalive task restarting -- up
REM to a full minute, since the task runs every minute -- the OLD process is
REM still serving traffic against a .next directory that has just been replaced.
REM Any route it had not touched yet goes to disk for a chunk hash that /MIR has
REM already deleted, and throws:
REM
REM     Error [ChunkLoadError]: Failed to load chunk server/chunks/ssr/src_<hash>._.js
REM     Cannot find module '/volume1/app/myhomebase/.next/server/chunks/ssr/...'
REM
REM When that lands on a layout the browser gets a 500 with no stylesheet, which
REM on a phone reads as "the app is completely broken" rather than as a deploy in
REM progress. The failure is invisible here and invisible to `npm run verify` --
REM it is not in the code, it is in the ordering.
REM
REM Writing the trigger first means the restart happens DURING or immediately
REM after the copy instead of a minute behind it. The trade is a few seconds of
REM connection refused (honest, and the PWA retries) instead of up to a minute of
REM 500s served from a half-replaced build. If start.sh fires mid-copy the app
REM comes up on an incomplete tree and dies; the every-minute keepalive then
REM restarts it into the finished one, so this self-heals.
echo %DATE% %TIME%> "%NAS_PATH%\deploy.trigger"
if not exist "%NAS_PATH%\deploy.trigger" (
    echo.
    echo WARNING: could not write deploy.trigger. Continuing with the copy, but
    echo          the NAS will keep serving the old build until it is restarted.
)

REM /MIR so removed files disappear from the destination instead of piling up
REM across releases -- but robocopy never deletes anything matched by /XD or
REM /XF, which is what keeps the live database, the secrets and the NAS-side
REM launcher safe. Same pattern REBUILD_PUBLISH.bat relies on.
REM
REM deploy.trigger stays in /XF: it was just written above, and letting /MIR
REM consider it would delete it again (it does not exist in staging).
robocopy "%STAGING%" "%NAS_PATH%" /MIR /XD data /XF .env start.sh app.log app.pid deploy.trigger /R:2 /W:2 >nul
if errorlevel 8 goto :robocopy_failed

echo.
echo Published to %NAS_PATH%
if not exist "%NAS_PATH%\.env" (
    echo.
    echo NOTE: no .env in the destination yet. Create one there with
    echo       MYHOMEBASE_DB, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
    echo       GOOGLE_REDIRECT_URI and ADMIN_SIGNUP_SECRET before starting.
    echo       See INSTRUCTION_SETUP_SYNOLOGY.md.
)
if not exist "%NAS_PATH%\start.sh" (
    echo.
    echo NOTE: no start.sh in the destination. See INSTRUCTION_SETUP_SYNOLOGY.md
    echo       Part 6 -- it is created once on the NAS, not shipped by this build.
)
echo.
echo Restart requested BEFORE the copy, so the NAS switches over as the new files
echo land rather than up to a minute later -- see the comment above the trigger.
echo Expect a few seconds of "connection refused" rather than 500s.
echo.
echo If the app is still down after ~2 minutes, check app.log: the keepalive task
echo retries every minute and its last lines say what stopped it.
echo.
echo To switch over immediately: DSM -^> Task Scheduler -^> select
echo "MyHomeBase keepalive" -^> Run.
echo.
echo IF THIS RELEASE ADDS A MIGRATION, apply it over SSH before the restart:
echo     cd /volume1/app/myhomebase ^&^& node --env-file-if-exists=.env migrate.cjs
echo.
exit /b 0

:robocopy_failed
echo ROBOCOPY FAILED (exit code %ERRORLEVEL%^). Aborting publish.
exit /b 1
