@echo off
setlocal
REM Starts the published production build (server.js from the standalone
REM output). Run this from inside the deployed folder that
REM REBUILD_PUBLISH.bat published to.
REM
REM Usage: START_PRD.bat [port]   (default port: 5200)

set "PORT_NUMBER=%~1"
if "%PORT_NUMBER%"=="" set "PORT_NUMBER=5200"

cd /d "%~dp0"

if not exist "server.js" (
    echo server.js not found in "%~dp0".
    echo Run this from the folder REBUILD_PUBLISH.bat published to.
    exit /b 1
)

REM Kill any process already listening on PORT_NUMBER so the server can bind cleanly.
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "LISTENING" ^| findstr ":%PORT_NUMBER% "') do (
    echo Killing process %%a currently using port %PORT_NUMBER%...
    taskkill /F /PID %%a >nul 2>&1
)

set "PORT=%PORT_NUMBER%"
node server.js
