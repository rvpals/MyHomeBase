@echo off
REM Review which root .md docs need updating based on code changes.
REM Calls Claude headless to compare the diff against each doc.
REM See scripts/review-release-docs.ps1 for details.
REM
REM   review_release_docs.bat              against HEAD (uncommitted changes)
REM   review_release_docs.bat -Since main  against main branch
REM   review_release_docs.bat -Model opus  use opus instead of haiku

setlocal
set "PS=pwsh"
where /q pwsh || set "PS=powershell"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\review-release-docs.ps1" %*
exit /b %ERRORLEVEL%
