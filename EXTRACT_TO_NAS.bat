@echo off
setlocal enabledelayedexpansion
REM Extracts a NAS build zip and publishes it to the Synology NAS over SMB.
REM The zip is produced by REBUILD_FOR_NAS.bat.
REM
REM Usage: EXTRACT_TO_NAS.bat <zip-file>
REM        e.g.  EXTRACT_TO_NAS.bat NAS_20261110_143022.zip
REM
REM This is for machines that have NAS access but no dev toolchain -- pull
REM the zip from git or copy it over, then run this script.

REM ===========================================================================
REM Configuration. Edit this to match your NAS share.
REM ===========================================================================
set "NAS_PATH=\\NAS_DS223\app\myhomebase"
REM ===========================================================================

REM Strip a trailing backslash so the path concatenates predictably.
if "%NAS_PATH:~-1%"=="\" set "NAS_PATH=%NAS_PATH:~0,-1%"

REM Run everything from the repo root regardless of caller's cwd.
cd /d "%~dp0"

REM --- Validate the zip argument ---
if "%~1"=="" (
    echo Usage: EXTRACT_TO_NAS.bat ^<zip-file^>
    echo        e.g.  EXTRACT_TO_NAS.bat NAS_20261110_143022.zip
    exit /b 1
)

set "ZIP_FILE=%~f1"
if not exist "%ZIP_FILE%" (
    echo File not found: %ZIP_FILE%
    exit /b 1
)

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

REM --- Step 2: Extract to a temp folder ---
set "TEMP_DIR=%TEMP%\myhomebase_deploy_%RANDOM%"
echo === Extracting "%ZIP_FILE%" ===
echo   to %TEMP_DIR%
echo.
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%TEMP_DIR%' -Force"
if errorlevel 1 (
    echo EXTRACT FAILED.
    exit /b 1
)

if not exist "%TEMP_DIR%\server.js" (
    echo "%TEMP_DIR%\server.js" not found. The zip does not contain a valid build.
    rd /s /q "%TEMP_DIR%" 2>nul
    exit /b 1
)

echo === Publishing to "%NAS_PATH%" ===

REM --- Step 3: Deploy trigger ---
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

REM --- Step 4: Robocopy to NAS ---
REM /MIR so removed files disappear from the destination instead of piling up
REM across releases. Robocopy never deletes anything matched by /XD or /XF,
REM which keeps the live database, secrets, and NAS-side launcher safe.
echo Copying files...
echo.
robocopy "%TEMP_DIR%" "%NAS_PATH%" /MIR /XD data /XF .env start.sh app.log app.pid fallback.pid deploy.trigger /R:2 /W:2 /NP /NDL /NJH /NJS /NC /NS
if errorlevel 8 goto :robocopy_failed

REM --- Step 5: Clean up temp folder ---
rd /s /q "%TEMP_DIR%" 2>nul

REM --- Step 6: Post-publish guidance ---
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
rd /s /q "%TEMP_DIR%" 2>nul
exit /b 1
