# Copyright GraphCaster. All Rights Reserved.

param(
    [string] $UiDir = "",
    [string] $ShortcutDir = ""
)

$ErrorActionPreference = "Stop"

function Normalize-DirArg([string] $value) {
  if ($null -eq $value) {
    return ""
  }
  $t = $value.Trim().Trim([char]0x22).Trim([char]0x27)
  return $t
}

$UiDir = Normalize-DirArg $UiDir
$ShortcutDir = Normalize-DirArg $ShortcutDir

if ([string]::IsNullOrWhiteSpace($UiDir)) {
  $UiDir = $PSScriptRoot
}

if ([string]::IsNullOrWhiteSpace($UiDir)) {
  throw "UiDir is empty and PSScriptRoot is not set (run the script from disk, not as a dot-sourced snippet)."
}

if (-not (Test-Path -LiteralPath $UiDir -PathType Container)) {
  throw "UiDir is not a directory: $UiDir"
}

$ui = (Resolve-Path -LiteralPath $UiDir).Path

if ([string]::IsNullOrWhiteSpace($ShortcutDir)) {
  $ShortcutDir = $ui
}

if (-not (Test-Path -LiteralPath $ShortcutDir -PathType Container)) {
  throw "ShortcutDir is not a directory: $ShortcutDir"
}

$shortcutParent = (Resolve-Path -LiteralPath $ShortcutDir).Path

$exePath = Join-Path $ui "src-tauri\target\release\graph-caster-desktop.exe"
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
  throw "Tauri release binary not found: $exePath (run 'npm run build:desktop' first)"
}

$lnkPath = Join-Path $shortcutParent "GraphCaster.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $exePath
$shortcut.Arguments = ""
$shortcut.WorkingDirectory = $ui
$shortcut.Description = "GraphCaster desktop application"
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Host "Shortcut: $lnkPath"
