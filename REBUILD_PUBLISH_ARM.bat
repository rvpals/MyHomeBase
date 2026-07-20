@echo off
setlocal enabledelayedexpansion
REM Same as REBUILD_PUBLISH.bat, but swaps in a Linux/arm64 native build of
REM better-sqlite3 at the end so the published output runs on an ARM-based
REM Synology NAS (e.g. RTD1619B / DS223) instead of the Windows x64 binary
REM produced by the local "npm run build".
REM
REM Usage: REBUILD_PUBLISH_ARM.bat <destination-folder> [nas-node-version]
REM   destination-folder : same as REBUILD_PUBLISH.bat.
REM   nas-node-version   : Node.js version running on the NAS (default 20.19.5).
REM                        Must match "node --version" on the NAS -- better-sqlite3
REM                        prebuilds are locked to a specific Node ABI, not just
REM                        OS/arch. Check with the NAS's own `node --version`.
REM
REM Never touches an existing data\ folder or .env file already present in
REM the destination -- a republish refreshes the app only, not the live
REM database or production secrets.

if "%~1"=="" (
    echo Usage: REBUILD_PUBLISH_ARM.bat ^<destination-folder^> [nas-node-version]
    exit /b 1
)

REM Resolve the destination to an absolute path before we change directory.
set "DEST=%~f1"

set "NAS_NODE_VERSION=%~2"
if "%NAS_NODE_VERSION%"=="" set "NAS_NODE_VERSION=20.19.5"

REM Run everything from the repo root regardless of caller's cwd.
cd /d "%~dp0"

set "STAGING=%~dp0.publish"

echo === Building production bundle ===
call npm run build
if errorlevel 1 (
    echo BUILD FAILED. Aborting publish.
    exit /b 1
)

if not exist ".next\standalone" (
    echo .next\standalone not found. Is "output: standalone" set in next.config.ts?
    exit /b 1
)

echo === Staging flat deployment at "%STAGING%" ===
if exist "%STAGING%" rmdir /s /q "%STAGING%"
mkdir "%STAGING%"

REM Standalone server + traced node_modules (server.js, package.json, node_modules\, .next\).
REM /XD data /XF .env belt-and-suspenders: outputFileTracingExcludes in
REM next.config.ts already keeps these out of .next\standalone, but exclude
REM them here too so a dev database or dev secrets can never reach staging.
robocopy ".next\standalone" "%STAGING%" /E /XD data /XF .env /R:2 /W:2 >nul
if errorlevel 8 goto :robocopy_failed

REM Static assets aren't included in standalone output and must be copied
REM alongside it manually so server.js can serve them.
robocopy ".next\static" "%STAGING%\.next\static" /E /R:2 /W:2 >nul
if errorlevel 8 goto :robocopy_failed

if exist "public" (
    robocopy "public" "%STAGING%\public" /E /R:2 /W:2 >nul
    if errorlevel 8 goto :robocopy_failed
)

REM Migrations + a plain-JS migration runner, so schema changes can be
REM applied against the production database after publishing.
robocopy "migrations" "%STAGING%\migrations" /E /R:2 /W:2 >nul
if errorlevel 8 goto :robocopy_failed

echo === Compiling migration runner ===
call npx tsc -p scripts\tsconfig.migrate.json --outDir "%STAGING%\scripts"
if errorlevel 1 (
    echo Failed to compile scripts\migrate.ts. Aborting publish.
    exit /b 1
)

copy /y ".env.example" "%STAGING%\.env.example" >nul
copy /y "START_PRD.bat" "%STAGING%\START_PRD.bat" >nul
copy /y "start_prd.sh" "%STAGING%\start_prd.sh" >nul

echo === Publishing to "%DEST%" ===
if not exist "%DEST%" mkdir "%DEST%"

REM Mirror the staged build into the destination, but /XD data and /XF .env
REM mean those are skipped entirely -- neither copied nor deleted -- so an
REM existing production database and secrets file are always preserved.
robocopy "%STAGING%" "%DEST%" /MIR /XD data /XF .env /R:2 /W:2 >nul
if errorlevel 8 goto :robocopy_failed

REM Apply any pending schema migrations to the destination's live database.
REM This runs with the local Windows Node against %DEST%\node_modules, so it
REM MUST happen before the better-sqlite3 binary is swapped for Linux/arm64
REM below -- otherwise Windows Node couldn't load the migration runner's own
REM DB driver. scripts\migrate.js backs up the existing .db file (timestamped,
REM next to it in data\) before touching anything, and only ever applies
REM migrations it hasn't already recorded as run -- so this is safe to run on
REM every publish, even when there's nothing new to apply.
echo === Applying database migrations at "%DEST%" ===
pushd "%DEST%"
call node scripts\migrate.js
if errorlevel 1 (
    popd
    echo.
    echo MIGRATION FAILED. App code was published, but the database may not be
    echo fully up to date. A backup was taken in "%DEST%\data" before any
    echo changes were attempted -- restore from there if needed.
    exit /b 1
)
popd

REM Swap the just-migrated Windows x64 better-sqlite3 binary for a Linux/arm64
REM one matching the NAS's Node ABI. Must be the last file-touching step.
echo === Fetching linux-arm64 (Node %NAS_NODE_VERSION%) native binary for better-sqlite3 ===
if not exist "%DEST%\node_modules\better-sqlite3" (
    echo better-sqlite3 not found in "%DEST%\node_modules". Skipping ARM binary swap.
) else (
    pushd "%DEST%\node_modules\better-sqlite3"
    call npx --yes prebuild-install --platform=linux --arch=arm64 --tag-prefix=v --target=%NAS_NODE_VERSION%
    if errorlevel 1 (
        popd
        echo.
        echo Failed to fetch a linux-arm64 prebuild for better-sqlite3 targeting
        echo Node %NAS_NODE_VERSION%. Check that this exact version/platform/arch
        echo combo has a published prebuild on the better-sqlite3 GitHub releases
        echo page, or pass a different nas-node-version argument.
        exit /b 1
    )
    popd
)

echo.
echo Published to %DEST%
if not exist "%DEST%\.env" (
    echo NOTE: no .env found in the destination yet. Copy .env.example to .env
    echo       there and fill in real values before starting the server.
)
echo To start the server on the NAS:
echo     sh "%DEST%\start_prd.sh" [port]
exit /b 0

:robocopy_failed
echo ROBOCOPY FAILED (exit code %ERRORLEVEL%^). Aborting publish.
exit /b 1
