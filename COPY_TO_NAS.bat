@echo off
setlocal enabledelayedexpansion
REM Copies a locally-built aarch64 package to the Synology NAS over SMB.
REM Run REBUILD_FOR_NAS.bat first to produce the build output.
REM
REM Usage: COPY_TO_NAS.bat [source-folder]
REM        (source defaults to SOURCE_DIR below)
REM
REM This is the publish-only half of REBUILD_PUBLISH_NAS.bat -- no build,
REM just the copy, restart trigger, and post-deploy guidance.

REM ===========================================================================
REM Configuration. Edit these to match your environment.
REM ===========================================================================
set "NAS_PATH=\\NAS_DS223\app\myhomebase"
set "SOURCE_DIR=%~dp0dist-nas"
REM ===========================================================================

if not "%~1"=="" set "SOURCE_DIR=%~f1"

REM Strip trailing backslashes so paths concatenate predictably.
if "%NAS_PATH:~-1%"=="\" set "NAS_PATH=%NAS_PATH:~0,-1%"
if "%SOURCE_DIR:~-1%"=="\" set "SOURCE_DIR=%SOURCE_DIR:~0,-1%"

REM Run everything from the repo root regardless of caller's cwd.
cd /d "%~dp0"

REM --- Step 1: NAS reachability check ---
if not exist "%NAS_PATH%\" (
    echo Cannot reach "%NAS_PATH%".
    echo.
    echo   - Is the NAS powered on and on the network?
    echo   - Is the shared folder mounted / accessible in Explorer?
    echo   - Windows may need credentials: open \\NAS_DS223 in Explorer once
    echo     and tick "Remember my credentials".
    exit /b 1
)

REM --- Verify the build exists ---
if not exist "%SOURCE_DIR%\server.js" (
    echo "%SOURCE_DIR%\server.js" not found.
    echo Run REBUILD_FOR_NAS.bat first to produce the build output.
    exit /b 1
)

echo === Publishing "%SOURCE_DIR%" to "%NAS_PATH%" ===

REM --- Step 2: Deploy trigger ---
REM Written BEFORE the copy, not after. See REBUILD_PUBLISH_NAS.bat for the
REM full explanation: writing it first means the NAS restarts during/after the
REM copy (a few seconds of connection refused) instead of serving 500s from a
REM half-replaced build for up to a minute.
echo %DATE% %TIME%> "%NAS_PATH%\deploy.trigger"
if not exist "%NAS_PATH%\deploy.trigger" (
    echo.
    echo WARNING: could not write deploy.trigger. Continuing with the copy, but
    echo          the NAS will keep serving the old build until it is restarted.
)

REM --- Step 3: Robocopy to NAS ---
REM /MIR so removed files disappear from the destination instead of piling up
REM across releases. Robocopy never deletes anything matched by /XD or /XF,
REM which keeps the live database, secrets, and NAS-side launcher safe.
echo Copying files...
echo.
robocopy "%SOURCE_DIR%" "%NAS_PATH%" /MIR /XD data /XF .env start.sh app.log app.pid fallback.pid deploy.trigger /R:2 /W:2 /NP /NDL /NJH /NJS /NC /NS
if errorlevel 8 goto :robocopy_failed

REM --- Step 4: Post-publish guidance ---
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
echo If the app is still down after ~2 minutes, just open it in the browser: when
echo server.js cannot start, start.sh serves the last 100 lines of app.log as a
echo page on port 3000 instead, with the likely cause named. The keepalive task
echo keeps retrying every minute and the page refreshes itself.
echo.
echo   NOTE start.sh is NOT shipped by this publish. If the failure page never
echo   appears, run COPY_NAS_START_SH.bat once to update the NAS-side launcher.
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
