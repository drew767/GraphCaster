# Copyright GraphCaster. All Rights Reserved.
param(
    [Parameter(Mandatory = $true)]
    [string] $ExePath,
    [Parameter(Mandatory = $true)]
    [string] $ShortcutPath,
    [Parameter(Mandatory = $true)]
    [string] $WorkingDirectory
)

$w = New-Object -ComObject WScript.Shell
$s = $w.CreateShortcut($ShortcutPath)
$s.TargetPath = $ExePath
$s.WorkingDirectory = $WorkingDirectory
$s.Description = 'Agent Queue Monitor'
$s.Save()
