@echo off
REM Builds MyHomeBase for the NAS, publishes it, and restarts the app immediately.
REM
REM REBUILD_PUBLISH_NAS.bat + the manual step that used to follow it:
REM   DSM -> Task Scheduler -> "MyHomeBase keepalive" -> Run.
REM
REM Use this one when you want the new build live now. Use REBUILD_PUBLISH_NAS.bat when
REM you are happy to let the every-minute keepalive task pick the release up on its own
REM (it always will -- the restart here only skips the wait).
REM
REM This window stays open until the NAS has actually confirmed the app is listening on
REM port 3000, including start.sh's port probe and any pending migration. A failure is
REM reported here rather than left in app.log.
REM
REM A thin wrapper around REBUILD_PUBLISH_NAS_START.ps1 so this is double-clickable from
REM Explorer. All the logic -- and the SSH connection settings -- live in the .ps1; edit
REM that one, not this.
REM
REM Usage: REBUILD_PUBLISH_NAS_START.bat [ssh-user] [host]

cd /d "%~dp0"

set "PS_ARGS="
if not "%~1"=="" set "PS_ARGS=-NasUser %~1"
if not "%~2"=="" set "PS_ARGS=%PS_ARGS% -NasHost %~2"

REM -NoProfile so a slow or noisy user profile can't interfere. -ExecutionPolicy Bypass
REM because the default policy blocks a local .ps1 on a stock Windows install, and this
REM script is the one being run deliberately.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0REBUILD_PUBLISH_NAS_START.ps1" %PS_ARGS%
set "EXITCODE=%ERRORLEVEL%"

REM Double-clicked from Explorer the window would vanish before the result could be read,
REM including the failure text that says what to do next. Pause on success too: the point
REM of this script over the plain publish is that it reports whether the app came back up,
REM and that verdict is worth reading.
echo.
pause

exit /b %EXITCODE%
