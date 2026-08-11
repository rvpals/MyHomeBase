@echo off
REM Mechanical release for MyHomeBase, without Claude - see
REM scripts/manual-release.ps1 for what each step does.
REM
REM   manual_release.bat                  NAS (default)
REM   manual_release.bat -Target Windows  Windows only
REM   manual_release.bat -Target Both     both targets
REM   manual_release.bat -DryRun          show every action, change nothing
REM   manual_release.bat -NoPush          commit but do not push
REM   manual_release.bat -Yes             no confirmation prompts
REM
REM It does NOT publish: it stops and asks you to run REBUILD_PUBLISH_NAS.bat.
REM The changelog entry it writes is a placeholder - use /release when the
REM release deserves a described entry. Exit code 0 only if every step passed.

setlocal
set "PS=pwsh"
where /q pwsh || set "PS=powershell"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\manual-release.ps1" %*
exit /b %ERRORLEVEL%
