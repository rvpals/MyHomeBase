@echo off
REM Full quality gate for MyHomeBase - see scripts/full-test.ps1 for the stages.
REM
REM   full_test.bat                 run everything
REM   full_test.bat -SkipE2e        skip the Playwright browser sweep
REM   full_test.bat -StopOnFirst    fail fast, like `npm run verify`
REM
REM Unlike `npm run verify`, a failing stage does not stop the rest: one run
REM reports every problem. Exit code is 0 only if every stage that ran passed.

setlocal
set "PS=pwsh"
where /q pwsh || set "PS=powershell"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\full-test.ps1" %*
exit /b %ERRORLEVEL%
