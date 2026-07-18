@echo off
setlocal enabledelayedexpansion
REM Builds MyHomeBase for production and publishes a flat, self-contained
REM deployment folder to the given destination.
REM
REM Usage: REBUILD_PUBLISH.bat <destination-folder>
REM
REM Never touches an existing data\ folder or .env file already present in
REM the destination -- a republish refreshes the app only, not the live
REM database or production secrets.

if "%~1"=="" (
    echo Usage: REBUILD_PUBLISH.bat ^<destination-folder^>
    exit /b 1
)

REM Resolve the destination to an absolute path before we change directory.
set "DEST=%~f1"

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

echo === Publishing to "%DEST%" ===
if not exist "%DEST%" mkdir "%DEST%"

REM Mirror the staged build into the destination, but /XD data and /XF .env
REM mean those are skipped entirely -- neither copied nor deleted -- so an
REM existing production database and secrets file are always preserved.
robocopy "%STAGING%" "%DEST%" /MIR /XD data /XF .env /R:2 /W:2 >nul
if errorlevel 8 goto :robocopy_failed

REM Apply any pending schema migrations to the destination's live database.
REM scripts\migrate.js backs up the existing .db file (timestamped, next to
REM it in data\) before touching anything, and only ever applies migrations
REM it hasn't already recorded as run -- so this is safe to run on every
REM publish, even when there's nothing new to apply.
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

echo.
echo Published to %DEST%
if not exist "%DEST%\.env" (
    echo NOTE: no .env found in the destination yet. Copy .env.example to .env
    echo       there and fill in real values before starting the server.
)
echo To start the server:
echo     "%DEST%\START_PRD.bat" [port]
exit /b 0

:robocopy_failed
echo ROBOCOPY FAILED (exit code %ERRORLEVEL%^). Aborting publish.
exit /b 1
