@echo off
setlocal
REM Starts the Next.js dev server.
REM
REM Usage: START_DEV.bat [port]   (default port: 3000)

set "PORT_NUMBER=%~1"
if "%PORT_NUMBER%"=="" set "PORT_NUMBER=3000"

cd /d "%~dp0"

REM Kill any process already listening on PORT_NUMBER so the dev server can bind cleanly.
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "LISTENING" ^| findstr ":%PORT_NUMBER% "') do (
    echo Killing process %%a currently using port %PORT_NUMBER%...
    taskkill /F /PID %%a >nul 2>&1
)

npm run dev -- -p %PORT_NUMBER%
