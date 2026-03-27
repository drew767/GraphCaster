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
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  $npm = Get-Command npm -ErrorAction Stop
}
if (-not (Test-Path -LiteralPath (Join-Path $ui "node_modules"))) {
  throw "node_modules not found under ui (run npm ci): $ui"
}
$lnkPath = Join-Path $shortcutParent "GraphCaster.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $npm.Source
$shortcut.Arguments = "run preview:web"
$shortcut.WorkingDirectory = $ui
$shortcut.Description = "GraphCaster: Vite preview of ui/dist (no browser auto-open; open http://127.0.0.1:4173 )"
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Host "Shortcut: $lnkPath"
