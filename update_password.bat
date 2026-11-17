@echo off
setlocal EnableExtensions
REM Changes an existing user's password. Thin wrapper over the `set-password`
REM CLI command, which does the real work in src/lib/user.
REM
REM Usage: update_password.bat [env-file]   (default: .env.dev)
REM
REM The env file is loaded exactly as START_DEV.bat loads it, so the change
REM lands in the SAME database the dev server uses. Without it the CLI would
REM fall back to ./data/myhomebase.db and the password would not change.

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

set "TARGET_USERNAME="
set /p "TARGET_USERNAME=Username: "
if not defined TARGET_USERNAME (
    echo Username is required - nothing changed.
    exit /b 1
)

REM Read the password without echoing it. If PowerShell is unavailable the
REM fallback below asks again with a visible prompt rather than failing.
set "NEW_PASSWORD="
echo New password ^(at least 8 characters, not shown^):
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$s = Read-Host -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))" 2^>nul`) do set "NEW_PASSWORD=%%P"
if not defined NEW_PASSWORD (
    set /p "NEW_PASSWORD=New password (visible): "
)
if not defined NEW_PASSWORD (
    echo Password is required - nothing changed.
    exit /b 1
)
if "%NEW_PASSWORD:~7,1%"=="" (
    echo Password must be at least 8 characters - nothing changed.
    exit /b 1
)

REM Typed twice: a typo in a masked field would otherwise lock the account out.
set "CONFIRM_PASSWORD="
echo Confirm new password:
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$s = Read-Host -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))" 2^>nul`) do set "CONFIRM_PASSWORD=%%P"
if not defined CONFIRM_PASSWORD (
    set /p "CONFIRM_PASSWORD=Confirm new password (visible): "
)
if not "%NEW_PASSWORD%"=="%CONFIRM_PASSWORD%" (
    set "NEW_PASSWORD="
    set "CONFIRM_PASSWORD="
    echo The two passwords do not match - nothing changed.
    exit /b 1
)
set "CONFIRM_PASSWORD="

set "CLI_OUTPUT=%TEMP%\mhb-set-password-%RANDOM%.txt"
echo.
echo Updating password for "%TARGET_USERNAME%" ...
call npx tsx src/cli/index.ts set-password --username "%TARGET_USERNAME%" --password "%NEW_PASSWORD%" > "%CLI_OUTPUT%" 2>&1
set "CLI_EXIT=%ERRORLEVEL%"
set "NEW_PASSWORD="

REM src/cli/set-password.ts exits 2 with 'User "x" does not exist.'
if "%CLI_EXIT%"=="2" (
    echo.
    echo User "%TARGET_USERNAME%" does not exist.
    del "%CLI_OUTPUT%" >nul 2>&1
    exit /b 2
)

type "%CLI_OUTPUT%"
del "%CLI_OUTPUT%" >nul 2>&1
exit /b %CLI_EXIT%
