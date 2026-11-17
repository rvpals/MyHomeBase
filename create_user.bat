@echo off
setlocal EnableExtensions
REM Creates a MyHomeBase user. Thin wrapper over the `create-user` CLI command,
REM which does the real work in src/lib/user.
REM
REM Usage: create_user.bat [env-file]   (default: .env.dev)
REM
REM The env file is loaded exactly as START_DEV.bat loads it, so the account
REM lands in the SAME database the dev server uses. Without it the CLI would
REM fall back to ./data/myhomebase.db and the new user would not show up.

cd /d "%~dp0"

set "ENV_FILE=%~1"
if "%ENV_FILE%"=="" set "ENV_FILE=.env.dev"

if exist "%ENV_FILE%" (
    echo Loading environment from %ENV_FILE% ...
    for /f "usebackq eol=# tokens=1* delims==" %%K in ("%ENV_FILE%") do (
        if not "%%~K"=="" set "%%~K=%%~L"
    )
) else (
    echo No env file at "%ENV_FILE%" - using the ambient environment only.
)

if defined MYHOMEBASE_DB (
    echo Database: %MYHOMEBASE_DB%
) else (
    echo Database: .\data\myhomebase.db  [MYHOMEBASE_DB not set]
)
echo.

set "NEW_USERNAME="
set /p "NEW_USERNAME=Username: "
if not defined NEW_USERNAME (
    echo Username is required - nothing created.
    exit /b 1
)

set "NEW_FULLNAME="
set /p "NEW_FULLNAME=Full name [%NEW_USERNAME%]: "
if not defined NEW_FULLNAME set "NEW_FULLNAME=%NEW_USERNAME%"

set "NEW_ROLE="
set /p "NEW_ROLE=Role - user or admin [user]: "
if not defined NEW_ROLE set "NEW_ROLE=user"
if /i not "%NEW_ROLE%"=="user" if /i not "%NEW_ROLE%"=="admin" (
    echo Role must be "user" or "admin" - nothing created.
    exit /b 1
)

REM Read the password without echoing it. If PowerShell is unavailable the
REM fallback below asks again with a visible prompt rather than failing.
set "NEW_PASSWORD="
echo Password ^(at least 8 characters, not shown^):
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$s = Read-Host -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))" 2^>nul`) do set "NEW_PASSWORD=%%P"
if not defined NEW_PASSWORD (
    set /p "NEW_PASSWORD=Password (visible): "
)
if not defined NEW_PASSWORD (
    echo Password is required - nothing created.
    exit /b 1
)
if "%NEW_PASSWORD:~7,1%"=="" (
    echo Password must be at least 8 characters - nothing created.
    exit /b 1
)

set "CLI_OUTPUT=%TEMP%\mhb-create-user-%RANDOM%.txt"
echo.
echo Creating "%NEW_USERNAME%" ...
call npx tsx src/cli/index.ts create-user --username "%NEW_USERNAME%" --full-name "%NEW_FULLNAME%" --password "%NEW_PASSWORD%" --role "%NEW_ROLE%" > "%CLI_OUTPUT%" 2>&1
set "CLI_EXIT=%ERRORLEVEL%"
set "NEW_PASSWORD="

REM src/lib/user throws DuplicateUsernameError -> 'Username "x" is already taken.'
findstr /c:"is already taken" "%CLI_OUTPUT%" >nul
if not errorlevel 1 (
    echo.
    echo User "%NEW_USERNAME%" already exists.
    del "%CLI_OUTPUT%" >nul 2>&1
    exit /b 2
)

type "%CLI_OUTPUT%"
del "%CLI_OUTPUT%" >nul 2>&1
exit /b %CLI_EXIT%
