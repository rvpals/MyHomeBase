@echo off
setlocal
REM Displays the list of application users.
REM Runs through the CLI adapter (src/cli), which loads .env and therefore
REM reads the same database as the app (C:/webapp/MHB_DATA/myhomebase.db).

cd /d "%~dp0"

call npm run cli -- list-users

echo.
pause
