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

exit /b 0
