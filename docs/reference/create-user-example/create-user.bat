@echo off
REM Windows batch wrapper. Double-click or schedule as a task.
REM Runs the EXACT same createUser use-case the web UI runs.
REM Usage: create-user.bat --email a@b.com --name "Alice" --password secret123
npx tsx src\cli\index.ts create-user %*
