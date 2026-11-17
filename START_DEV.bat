@echo off
setlocal
REM Starts the Next.js dev server.
REM
REM Usage: START_DEV.bat [port] [env-file]   (defaults: port 3000, .env.dev)
REM
REM The env file is a plain KEY=VALUE file in this folder (# starts a comment).
REM Its values are exported into this process before npm starts, and a real
REM environment variable beats any .env / .env.local Next.js would load itself.

set "PORT_NUMBER=%~1"
if "%PORT_NUMBER%"=="" set "PORT_NUMBER=3000"

set "ENV_FILE=%~2"
if "%ENV_FILE%"=="" set "ENV_FILE=.env.dev"

cd /d "%~dp0"

if exist "%ENV_FILE%" (
    echo Loading environment from %ENV_FILE% ...
    for /f "usebackq eol=# tokens=1* delims==" %%K in ("%ENV_FILE%") do (
        if not "%%~K"=="" set "%%~K=%%~L"
    )
) else (
    echo No env file at "%ENV_FILE%" - starting with the ambient environment only.
)

REM Kill any process already listening on PORT_NUMBER so the dev server can bind cleanly.
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "LISTENING" ^| findstr ":%PORT_NUMBER% "') do (
    echo Killing process %%a currently using port %PORT_NUMBER%...
    taskkill /F /PID %%a >nul 2>&1
)

npm run dev -- -p %PORT_NUMBER%
