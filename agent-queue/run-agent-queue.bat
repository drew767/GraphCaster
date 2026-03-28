@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
if exist "%LOCALAPPDATA%\cursor-agent" set "PATH=%LOCALAPPDATA%\cursor-agent;%PATH%"
cd /d "%~dp0..\.."
set "ARGS=%*"
if "%ARGS%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-queue.ps1" -InteractiveSetup
    exit /b %ERRORLEVEL%
)
set NEED_CYCLES=1
echo %ARGS%| findstr /i /C:"-Cycles" >nul
if not errorlevel 1 set NEED_CYCLES=0
if "%NEED_CYCLES%"=="1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-queue.ps1" -InteractiveCycles %ARGS%
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-queue.ps1" %ARGS%
)
exit /b %ERRORLEVEL%
