@REM Copyright GraphCaster. All Rights Reserved.
@echo off
setlocal
set "AGENT_PS1=%LOCALAPPDATA%\cursor-agent\agent.ps1"
if not exist "%AGENT_PS1%" (
    echo [ERROR] Not found: %AGENT_PS1%
    echo Run build-monitor.bat here first or install Cursor Agent CLI.
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%AGENT_PS1%" login %*
exit /b %ERRORLEVEL%
