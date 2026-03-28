# Copyright Aura. All Rights Reserved.
# Same rules as AgentQueuePathFinder.GetDefaultCursorWorkspace (agent-queue folder path).
param(
    [Parameter(Mandatory = $true)]
    [string] $AgentQueueDirectory
)

$aq = [System.IO.Path]::GetFullPath($AgentQueueDirectory.TrimEnd([char]'\', [char]'/'))
$parent = [System.IO.Path]::GetFullPath((Join-Path $aq '..'))
$py = Join-Path $parent 'python'
$ui = Join-Path $parent 'ui'
if ((Test-Path -LiteralPath $py) -and (Test-Path -LiteralPath $ui)) {
    Write-Output $parent
    exit 0
}
$leaf = Split-Path -Leaf $parent
if ($leaf -ieq 'scripts') {
    Write-Output ([System.IO.Path]::GetFullPath([System.IO.Path]::Combine($aq, '..', '..')))
    exit 0
}
Write-Output $parent
