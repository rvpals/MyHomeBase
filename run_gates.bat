@echo off
setlocal
REM Runs every quality gate, cheapest first, and stops at the first failure.
REM
REM Usage:
REM   run_gates.bat             run all gates
REM   run_gates.bat --no-e2e    skip the Playwright browser smoke (the slow one)
REM
REM Order (same as `npm run verify` and CLAUDE.md):
REM   1. typecheck  2. lint  3. lib-boundary  4. unit tests
REM   5. migration dry-run  6. browser smoke (preflight, prepare DB, Playwright)
REM
REM Want every failure in one run instead of only the first? Use full_test.bat.
REM
REM Database safety: the dry-run and smoke work on copies in .verify\ and abort
REM if MYHOMEBASE_DB is unset or points inside the repo's data\ folder. Never
REM point MYHOMEBASE_DB at the live NAS file.
REM
REM The smoke needs ports 3000 and 3100 free. If the preflight says a port is
REM busy, stop your dev server yourself; this script will not kill it.

cd /d "%~dp0"

set "SKIP_E2E="
if /i "%~1"=="--no-e2e" set "SKIP_E2E=1"

echo === Clearing .next cache ===
call npm run clean:next || goto :fail_clean

call :gate "typecheck"           "npm run typecheck"            || goto :failed
call :gate "lint"                "npm run lint"                 || goto :failed
call :gate "lib-boundary"        "npm run check:lib-boundary"   || goto :failed
call :gate "unit tests"          "npm test"                     || goto :failed
call :gate "migration dry-run"   "npm run db:migrate:dry-run"   || goto :failed

if defined SKIP_E2E (
    echo.
    echo === Skipping browser smoke ^(--no-e2e^) ===
    goto :passed
)

call :gate "smoke preflight"     "npm run verify:preflight"     || goto :failed
call :gate "smoke DB prepare"    "npm run verify:prepare-db"    || goto :failed
call :gate "browser smoke"       "npm run test:e2e"             || goto :failed

:passed
echo.
echo ==========================================
if defined SKIP_E2E (
    echo  All gates PASSED ^(browser smoke skipped^)
) else (
    echo  All gates PASSED
)
echo ==========================================
echo A green smoke run does not replace checking the UI by eye.
exit /b 0

:failed
echo.
echo ==========================================
echo  FAILED at gate: %FAILED_GATE%
echo ==========================================
echo Gates after this one were not run.
exit /b 1

:fail_clean
echo.
echo Could not clear .next. Is a dev server holding files open?
exit /b 1

REM ---- :gate "<name>" "<command>" -- runs one gate and records its name on failure
:gate
echo.
echo === %~1 ===
call %~2
if errorlevel 1 (
    set "FAILED_GATE=%~1"
    exit /b 1
)
echo --- %~1: OK
exit /b 0
