@echo off
REM Copies start.sh to the NAS and makes it executable.
REM
REM A thin wrapper around COPY_NAS_START_SH.ps1 so this is double-clickable from Explorer,
REM the same way REBUILD_PUBLISH_NAS.bat is. All the logic -- and the connection settings --
REM live in the .ps1; edit that one, not this.
REM
REM Usage: COPY_NAS_START_SH.bat [ssh-user] [host]

cd /d "%~dp0"

set "PS_ARGS="
if not "%~1"=="" set "PS_ARGS=-NasUser %~1"
if not "%~2"=="" set "PS_ARGS=%PS_ARGS% -NasHost %~2"

REM -NoProfile so a slow or noisy user profile can't interfere. -ExecutionPolicy Bypass
REM because the default policy blocks a local .ps1 on a stock Windows install, and this
REM script is the one being run deliberately.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0COPY_NAS_START_SH.ps1" %PS_ARGS%
set "EXITCODE=%ERRORLEVEL%"

REM Double-clicked from Explorer the window would vanish before the result could be read,
REM including the failure text that says what to do next.
if not "%EXITCODE%"=="0" (
    echo.
    pause
)

exit /b %EXITCODE%
