@echo off
REM Copyright GraphCaster. All Rights Reserved.
setlocal EnableExtensions EnableDelayedExpansion
set "GCHOME=%~dp0"
cd /d "%GCHOME%ui" || exit /b 1

if not exist "package.json" (
    echo [GraphCaster] ui\package.json not found.
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [GraphCaster] npm not in PATH. Install Node.js 20+.
    exit /b 1
)

echo [GraphCaster] npm ci...
echo [GraphCaster] If npm ci fails with EPERM on esbuild.exe: stop Vite/Node, close IDEs touching ui, cd ui, rmdir /s /q node_modules, cd .., run build.bat again.
call npm ci
set "NPM_CI_EXIT=!ERRORLEVEL!"
if not "!NPM_CI_EXIT!"=="0" (
    echo [GraphCaster] npm ci failed ^(exit !NPM_CI_EXIT!^).
    exit /b 1
)

echo [GraphCaster] npm run build...
call npm run build
set "NPM_BUILD_EXIT=!ERRORLEVEL!"
if not "!NPM_BUILD_EXIT!"=="0" (
    echo [GraphCaster] build failed ^(exit !NPM_BUILD_EXIT!^).
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%GCHOME%ui\Create-GraphCaster-PreviewShortcut.ps1" -UiDir "%CD%" -ShortcutDir "%GCHOME%"
if errorlevel 1 (
    echo [GraphCaster] Could not create shortcut.
    exit /b 1
)

echo [GraphCaster] Build OK. Use GraphCaster.lnk next to build.bat to run Vite preview.
exit /b 0
