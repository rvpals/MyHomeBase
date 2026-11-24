@echo off
REM Dashboard of every batch file in this folder. Lists them with their
REM descriptions and runs the one you pick. Descriptions are read from the REM
REM header of each file, so new scripts appear here automatically.
setlocal enabledelayedexpansion
cd /d "%~dp0"
set /a blanks=0

:menu
cls
echo.
echo   MyHomeBase - batch file dashboard
echo   =================================
echo.
set /a count=0
for /f "delims=" %%F in ('dir /b /a-d *.bat 2^>nul ^| sort') do (
    if /i not "%%F"=="dash.bat" (
        set /a count+=1
        set "name=%%F"
        set "file[!count!]=%%F"
        set "desc="
        set "reading=1"
        for /f "usebackq delims=" %%A in (`findstr /b /i /c:"REM" "%%F" 2^>nul`) do (
            if "!reading!"=="1" (
                set "line=%%A"
                set "line=!line:~4!"
                if "!line!"=="" (
                    set "reading=0"
                ) else (
                    if defined desc (set "desc=!desc! !line!") else (set "desc=!line!")
                )
            )
        )
        if not defined desc set "desc=(no description)"
        if "!desc:~88,1!" neq "" set "desc=!desc:~0,88!..."
        set "pad=!name!                                   "
        set "pad=!pad:~0,33!"
        if !count! lss 10 (set "num= !count!") else (set "num=!count!")
        echo   [!num!] !pad! !desc!
    )
)
echo.
if %count%==0 (
    echo   No batch files found in %cd%.
    echo.
    pause
    goto :eof
)
echo   [ Q] Quit
echo.

set "pick="
set /p "pick=  Pick a number: "
if not defined pick (
    set /a blanks+=1
    if !blanks! geq 3 goto :eof
    goto menu
)
set /a blanks=0
if /i "%pick%"=="q" goto :eof
if /i "%pick%"=="quit" goto :eof

set "target="
for /f "delims=0123456789" %%X in ("%pick%") do set "target=bad"
if defined target goto :nope
set "target=!file[%pick%]!"
if not defined target goto :nope

echo.
echo   Selected: !target!
set "args="
set /p "args=  Arguments (press Enter for none): "
echo.
set "ok="
set /p "ok=  Run !target! !args! ? [Y/N] "
if /i not "!ok!"=="y" goto menu

echo.
echo   --- running !target! ---
echo.
call "%~dp0!target!" !args!
set "code=!errorlevel!"
echo.
echo   --- !target! finished with exit code !code! ---
echo.
pause
goto menu

:nope
echo.
echo   "%pick%" is not on the list.
echo.
pause
goto menu
