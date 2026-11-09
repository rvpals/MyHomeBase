@echo off
REM Copies CHANGE_HISTORY.md and MyHomeBase_feature.md to the NAS.
REM
REM The About page reads CHANGE_HISTORY.md from the running app's working
REM directory, so the deployed copy needs refreshing after a doc update.
REM MyHomeBase_feature.md is the feature catalogue shown alongside it.
REM
REM This is step 4 of the /release command, extracted so it can be run on
REM its own without a full release session.
REM
REM Usage: copy_change_history.bat [target-path]
REM
REM   copy_change_history.bat                          uses default NAS path
REM   copy_change_history.bat \\OTHER\share\folder     uses custom path

setlocal
cd /d "%~dp0"

REM ---- Configuration ----
set "DEFAULT_NAS_DEST=\\NAS_DS223\app\myhomebase"
REM -----------------------

if not "%~1"=="" (set "NAS_DEST=%~1") else (set "NAS_DEST=%DEFAULT_NAS_DEST%")
set "EXITCODE=0"

echo Copying CHANGE_HISTORY.md to %NAS_DEST% ...
copy /y "CHANGE_HISTORY.md" "%NAS_DEST%\CHANGE_HISTORY.md"
if errorlevel 1 (
    echo ERROR: Failed to copy CHANGE_HISTORY.md
    set "EXITCODE=1"
    goto :done
)

echo Copying MyHomeBase_feature.md to %NAS_DEST% ...
copy /y "MyHomeBase_feature.md" "%NAS_DEST%\MyHomeBase_feature.md"
if errorlevel 1 (
    echo ERROR: Failed to copy MyHomeBase_feature.md
    set "EXITCODE=1"
    goto :done
)

echo.
echo Done. Both files copied to %NAS_DEST%.

:done
if not "%EXITCODE%"=="0" (
    echo.
    pause
)

exit /b %EXITCODE%
