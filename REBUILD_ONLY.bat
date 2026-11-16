@echo off
setlocal
REM Rebuilds the whole codebase and nothing else. No packaging, no publishing,
REM no destination folder.
REM
REM Usage: REBUILD_ONLY.bat
REM
REM This is the compile-only sibling of REBUILD_FOR_NAS.bat: same production
REM build, minus the aarch64 cross-compile and the dist-nas package step. Use it
REM to find out whether the code in the working tree still builds -- type errors,
REM lint errors, bad imports, a missing module, a route that fails to compile.
REM
REM What it deliberately does NOT run: the quality gates. No unit tests, no
REM lib-boundary check, no migration dry-run, no Playwright smoke. A green run
REM here means "it compiles", not "it works".
REM
REM Type checking and ESLint are not skipped, though -- `next build` performs
REM both itself (next.config.ts sets neither ignoreBuildErrors nor
REM ignoreDuringBuilds), and the type pass covers everything in tsconfig's
REM include, so src/lib and src/cli are checked as well as the app routes.
REM
REM `npm run build` clears .next first, so a stale dev cache cannot produce a
REM phantom failure naming a file that no longer exists.
REM
REM The build does open the dev database while collecting page data. It only
REM reads, and it uses whatever MYHOMEBASE_DB your .env points at -- make sure
REM that is a local copy and never the live NAS file.

REM Run everything from the repo root regardless of caller's cwd.
cd /d "%~dp0"

echo === Rebuilding MyHomeBase (compile only, no gates) ===
echo.
call npm run build
if errorlevel 1 (
    echo.
    echo BUILD FAILED. See the errors above.
    exit /b 1
)

REM next.config.ts sets output: "standalone", so a successful build always
REM leaves a server entrypoint behind. If it is missing, the build reported
REM success without producing anything -- treat that as a failure too.
if not exist "%~dp0.next\standalone\server.js" (
    echo.
    echo Build reported success but ".next\standalone\server.js" is missing.
    echo The build did not produce a usable output.
    exit /b 1
)

echo.
echo === Build OK: the code compiles ===
echo Gates NOT run: unit tests, lib-boundary, migration dry-run, browser smoke.
exit /b 0
