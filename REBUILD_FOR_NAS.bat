@echo off
setlocal enabledelayedexpansion
REM Builds MyHomeBase for the Synology NAS (aarch64) into a local folder.
REM Copy the output to the NAS manually afterwards.
REM
REM Usage: REBUILD_FOR_NAS.bat [destination]
REM        (destination defaults to OUTPUT_DIR below)
REM
REM This is the build-only half of REBUILD_PUBLISH_NAS.bat -- same cross-compiled
REM package, but no NAS connectivity required. Use it when you want to inspect
REM the build or copy it yourself.

REM ===========================================================================
REM Output folder. Edit this or pass a command-line argument to override.
REM ===========================================================================
set "OUTPUT_DIR=%~dp0dist-nas"

if not "%~1"=="" set "OUTPUT_DIR=%~f1"

REM Strip a trailing backslash so the path concatenates predictably below.
if "%OUTPUT_DIR:~-1%"=="\" set "OUTPUT_DIR=%OUTPUT_DIR:~0,-1%"

REM Run everything from the repo root regardless of caller's cwd.
cd /d "%~dp0"

echo === Building aarch64 deployment package ===
echo Output: %OUTPUT_DIR%
echo.
call npm run publish:nas
if errorlevel 1 (
    echo BUILD FAILED.
    exit /b 1
)

if not exist "%OUTPUT_DIR%\server.js" (
    echo "%OUTPUT_DIR%\server.js" not found. The build did not produce a package.
    exit /b 1
)

REM --- Zip the build ---
set "ZIP_PATH=%~dp0NAS_DIST.zip"

echo.
echo === Zipping build to NAS_DIST.zip ===
if exist "%ZIP_PATH%" del "%ZIP_PATH%"
powershell -NoProfile -Command "Compress-Archive -Path '%OUTPUT_DIR%\*' -DestinationPath '%ZIP_PATH%' -Force"
if errorlevel 1 (
    echo WARNING: zip failed. The build folder is still available at %OUTPUT_DIR%.
) else (
    echo Created: %ZIP_PATH%
)

echo.
echo Build complete. Output is in:
echo   %OUTPUT_DIR%
echo.
echo Zip: %ZIP_PATH%
echo   Copy the zip to any machine with NAS access and run:
echo   EXTRACT_TO_NAS.bat NAS_DIST.zip
echo.
echo IF THIS RELEASE ADDS A MIGRATION, apply it on the NAS over SSH:
echo     cd /volume1/app/myhomebase ^&^& node --env-file-if-exists=.env migrate.cjs
echo.
exit /b 0
