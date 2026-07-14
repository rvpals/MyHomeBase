@echo off
setlocal
REM Starts the Next.js dev server.
REM Usage: start.bat

set PORT_NUMBER=3000

REM Kill any process already listening on PORT_NUMBER so the dev server can bind cleanly.
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "LISTENING" ^| findstr ":%PORT_NUMBER% "') do (
    echo Killing process %%a currently using port %PORT_NUMBER%...
    taskkill /F /PID %%a >nul 2>&1
)

npm run dev -- -p %PORT_NUMBER%
