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
REM /MIR so removed files disappear from the destination instead of piling up
REM across releases -- but robocopy never deletes anything matched by /XD or
REM /XF, which is what keeps the live database, the secrets and the NAS-side
REM launcher safe. Same pattern REBUILD_PUBLISH.bat relies on.
robocopy "%STAGING%" "%NAS_PATH%" /MIR /XD data /XF .env start.sh app.log app.pid deploy.trigger /R:2 /W:2 >nul
if errorlevel 8 goto :robocopy_failed

REM Ask the NAS to restart itself. start.sh checks for this file on every
REM scheduled run, cycles the process and deletes it -- so a release needs no
REM SSH. Written last, after the copy has fully landed, or the app could come
REM back up on a half-copied build.
echo %DATE% %TIME%> "%NAS_PATH%\deploy.trigger"
REM Checked by existence, not by errorlevel: robocopy above exits 1 for "files
REM were copied" (a success), and `echo` doesn't clear that, so an errorlevel
REM test here reports a failure on every successful publish.
if not exist "%NAS_PATH%\deploy.trigger" (
    echo.
    echo WARNING: could not write deploy.trigger. The new build is in place but
    echo          the NAS will keep serving the old one until it is restarted.
)

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
echo Restart requested. The "MyHomeBase keepalive" task picks up deploy.trigger
echo on its next run and switches to the new build -- no SSH needed.
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
