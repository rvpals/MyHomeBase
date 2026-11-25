@echo off
setlocal
REM Installs dependencies on THIS Windows machine and makes sure every native
REM binary the build needs is actually present, so REBUILD_FOR_NAS.bat /
REM REBUILD_ONLY.bat can run.
REM
REM Usage: install_dependencies_for_nas.bat
REM
REM Why this exists: npm 12 blocks dependency install scripts unless package.json
REM lists them under "allowScripts". better-sqlite3 builds its .node binding in an
REM install script, so a plain `npm install` silently leaves it with no binary and
REM `next build` dies at "Collecting page data" with:
REM     Error: Could not locate the bindings file ... better_sqlite3.node
REM
REM The approvals are pinned to the installed VERSION ("better-sqlite3@12.9.0").
REM After upgrading any of these packages, run this file again.
REM
REM What this does NOT do: fetch the linux-arm64 binaries for the NAS. Those are
REM downloaded and swapped in by scripts/publish-nas.mjs during REBUILD_FOR_NAS.bat.

cd /d "%~dp0"

echo === 1/4 npm install ===
call npm install
if errorlevel 1 (
    echo npm install FAILED.
    exit /b 1
)

echo.
echo === 2/4 Approving install scripts for native packages ===
REM better-sqlite3: compiles/fetches better_sqlite3.node (required -- nothing boots without it)
REM esbuild:        verifies its platform binary (used by publish-nas.mjs, vite, tsx)
REM unrs-resolver:  installs its native resolver binding if the optional one is missing (lint)
call npm install-scripts approve better-sqlite3
if errorlevel 1 (
    echo Could not approve better-sqlite3. Is npm 12+ installed? Check with: npm -v
    exit /b 1
)
call npm install-scripts approve esbuild
call npm install-scripts approve unrs-resolver
REM tesseract.js's script only prints a donation message -- deny it so npm stops warning.
call npm install-scripts deny tesseract.js

echo.
echo === 3/4 Rebuilding native packages ===
call npm rebuild better-sqlite3 esbuild unrs-resolver
if errorlevel 1 (
    echo npm rebuild FAILED.
    exit /b 1
)

echo.
echo === 4/4 Checking each native module loads ===
REM ':memory:' only -- this never opens a database file.
node -e "const D=require('better-sqlite3'); const db=new D(':memory:'); console.log('  better-sqlite3 OK (SQLite ' + db.prepare('select sqlite_version() v').get().v + ')'); db.close()"
if errorlevel 1 (
    echo   better-sqlite3 FAILED to load. The build will fail at "Collecting page data".
    exit /b 1
)
node -e "require('esbuild').transformSync('1'); console.log('  esbuild OK')"
if errorlevel 1 (
    echo   esbuild FAILED to load. publish-nas.mjs cannot bundle the migration runner.
    exit /b 1
)
node -e "require('sharp'); console.log('  sharp OK')"
if errorlevel 1 (
    echo   sharp FAILED to load. Icon uploads will fail.
    exit /b 1
)
node -e "require('@napi-rs/canvas').createCanvas(1,1); console.log('  @napi-rs/canvas OK')"
if errorlevel 1 (
    echo   WARNING: @napi-rs/canvas failed to load. Scanned-PDF OCR will not work locally.
)

echo.
echo === Dependencies ready. Next: REBUILD_FOR_NAS.bat ===
exit /b 0
