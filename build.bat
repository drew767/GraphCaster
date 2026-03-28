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

where cargo >nul 2>&1
if errorlevel 1 (
    echo [GraphCaster] cargo not in PATH. Install Rust toolchain ^(https://rustup.rs^).
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

echo [GraphCaster] Building Tauri desktop app (npm run build:desktop)...
call npm run build:desktop
set "TAURI_EXIT=!ERRORLEVEL!"
if not "!TAURI_EXIT!"=="0" (
    echo [GraphCaster] Tauri build failed ^(exit !TAURI_EXIT!^).
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%GCHOME%ui\Create-GraphCaster-Shortcut.ps1" -UiDir "%CD%" -ShortcutDir "%GCHOME%"
if errorlevel 1 (
    echo [GraphCaster] Could not create shortcut.
    exit /b 1
)

echo [GraphCaster] Build OK. Use GraphCaster.lnk next to build.bat to launch the desktop app.
exit /b 0
