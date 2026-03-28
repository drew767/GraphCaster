# Copyright Aura. All Rights Reserved.
# Requires: Cursor Agent CLI (`agent`) - https://cursor.com/docs/cli/overview
# Install (Windows): irm 'https://cursor.com/install?win32=true' | iex
#
# Windows (see -Help):
# - CreateProcess command line ~8191 chars: long prompt goes to a UTF-8 temp file; prefer node.exe + index.js from the Cursor Agent install with prompt on stdin (no PowerShell pipe). Otherwise use the helper script (Get-Content | & agent.ps1).
# - stream-json: default is stdout piped through this script (NDJSON parsed, colored). If the CLI exits 1 with no captured output, set AGENT_QUEUE_STREAM_JSON_INHERIT_CONSOLE=1 or use -StreamJsonInheritConsole (raw NDJSON in the console, no formatting here).
# - Windows PowerShell 5.1: "[..." inside double quotes can be parsed as an expression; "#" inside "..." is risky; prefer single-quoted strings and concatenation.

[CmdletBinding()]
param(
    [Parameter()]
    [string] $PromptFile = "",
    [Parameter()]
    [string] $Workspace = "",
    [Parameter()]
    [string] $AgentExe = "agent",
    [Parameter()]
    [string] $Model = "composer-2",
    [Parameter()]
    [ValidateSet("agent", "plan", "ask")]
    [string] $Mode = "agent",
    [Parameter()]
    [ValidateSet("text", "json", "stream-json")]
    [string] $OutputFormat = "stream-json",
    [Parameter()]
    [switch] $NoTrust,
    [Parameter()]
    [switch] $NoForce,
    [Parameter()]
    [switch] $PipelineOrder,
    [Parameter()]
    [switch] $Sequential,
    [Parameter()]
    [ValidateRange(1, [int]::MaxValue)]
    [int] $Cycles = 1,
    [Parameter()]
    [switch] $Loop,
    [Parameter()]
    [int] $MaxRounds = 0,
    [Parameter()]
    [int] $DelaySeconds = 0,
    [Parameter()]
    [switch] $DryRun,
    [Parameter()]
    [switch] $InteractiveCycles,
    [Parameter()]
    [switch] $InteractiveSetup,
    [Parameter()]
    [switch] $HideThinking,
    [Parameter()]
    [switch] $RawStreamJson,
    [Parameter()]
    [switch] $NoStreamColor,
    [Parameter()]
    [ValidateRange(0, 1000000)]
    [int] $StreamBufferChars = 256,
    [Parameter()]
    [ValidateRange(0, 600000)]
    [int] $StreamBufferIdleMs = 0,
    [Parameter()]
    [switch] $AssistantStreamDelta,
    [Parameter()]
    [ValidateRange(1, [int]::MaxValue)]
    [int] $StartFromPrompt = 1,
    [Parameter()]
    [ValidateRange(0, [int]::MaxValue)]
    [int] $CyclesPerChat = 0,
    [Parameter()]
    [switch] $ContinueFirstPrompt,
    [Parameter()]
    [ValidateRange(0, 604800)]
    [int] $StallRestartSeconds = 800,
    [Parameter()]
    [ValidateRange(0, 10080)]
    [int] $StallRestartMinutes = 0,
    [Parameter()]
    [ValidateRange(0, 864000)]
    [int] $StallRestartGraceSeconds = 720,
    [Parameter()]
    [switch] $StallAllowManualRetry,
    [Parameter()]
    [string] $SuperpowerBrainstormingPath = "",
    [Parameter()]
    [string] $SuperpowerCodeReviewPath = "",
    [Parameter()]
    [string] $SuperpowerWritingPlansPath = "",
    [Parameter()]
    [string] $SuperpowerExecutingPlansPath = "",
    [Parameter()]
    [switch] $NoSuperpowerInject,
    [Parameter()]
    [switch] $Help,
    [Parameter()]
    [switch] $AgentQueueSmokeTest,
    [Parameter()]
    [switch] $StreamJsonInheritConsole,
    [Parameter()]
    [switch] $NoStreamJsonInheritConsole
)

$script:AgentQueueHideThinkingEffective = $HideThinking.IsPresent
$script:AgentQueueAssistantStreamDeltaEffective = $AssistantStreamDelta.IsPresent
if ($env:AGENT_QUEUE_HIDE_THINKING -eq '1') {
    $script:AgentQueueHideThinkingEffective = $true
}
elseif ($env:AGENT_QUEUE_HIDE_THINKING -eq '0') {
    $script:AgentQueueHideThinkingEffective = $false
}
if ($env:AGENT_QUEUE_ASSISTANT_STREAM_DELTA -eq '1') {
    $script:AgentQueueAssistantStreamDeltaEffective = $true
}
elseif ($env:AGENT_QUEUE_ASSISTANT_STREAM_DELTA -eq '0') {
    $script:AgentQueueAssistantStreamDeltaEffective = $false
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSVersion.Major -lt 6) {
    try {
        [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    }
    catch {
    }
}

$UseTrust = -not $NoTrust
$UseForce = -not $NoForce
$script:AgentQueueLastRunEndedByStallWatchdog = $false
$script:AgentQueueLastRunManualRestart = $false

# stream-json: default pipe (NDJSON parsed, colors). Console inherit only when -StreamJsonInheritConsole or env=1.
$script:AgentQueueStreamJsonInheritConsoleEffective = $false
if ($OutputFormat -eq 'stream-json') {
    if ($NoStreamJsonInheritConsole -or $env:AGENT_QUEUE_STREAM_JSON_INHERIT_CONSOLE -eq '0') {
        $script:AgentQueueStreamJsonInheritConsoleEffective = $false
    }
    elseif ($StreamJsonInheritConsole -or $env:AGENT_QUEUE_STREAM_JSON_INHERIT_CONSOLE -eq '1') {
        $script:AgentQueueStreamJsonInheritConsoleEffective = $true
    }
}

# ~8191 char CreateProcess limit; long prompt -> temp file + stdin after Start() (Invoke-AgentQueueMaybeUseStdinPrompt).
$script:AgentQueueMaxCmdLineChars = 7500

function Show-AgentQueueHelp {
    Write-Host @"
Usage: agent-queue/agent-queue.ps1 [-PromptFile path] [-Workspace path] [options]

Runs Cursor Agent CLI: first prompt uses agent -p (no --continue); later steps
use --continue. Default -Mode agent and -OutputFormat stream-json with
--stream-partial-output so the console shows progress; default --force avoids
headless stalls waiting for command approval. Use -Mode ask only for read-only.
With stream-json, output is colored by event type (thinking, assistant text,
read vs write/edit tools, shell, user/system/result); use -NoStreamColor for plain text.
Passes --model composer-2 (Composer 2 in Cursor) on every agent run by default.
Assistant stream-json deltas are buffered (see -StreamBufferChars) so the console does not
reflow each tiny chunk; flush on newlines, size threshold, idle gap, or event type change.
When the CLI sends a final assistant event after deltas, the full message is not printed twice.
By default, incremental assistant deltas are not printed (only the final assistant block, or the
accumulated text at end of the step if there is no final event). Pass -AssistantStreamDelta to
show streamed assistant text as it arrives (buffered; see -StreamBufferChars).
Pipeline mode (default for agent-queue.pipeline.prompts.txt, agent-queue.autotests.pipeline.prompts.txt, and agent-queue.general.pipeline.prompts.txt): at least 3 blocks
separated by ---. Block 1 starts a new chat; the last block anchors the next cycle;
the second-to-last block is the commit step. Step order (1-based block indices): first
cycle of a session runs 1..N in file order (through commit, then anchor). Later cycles
in the same chat run 2..N (repeat). The last global cycle runs 2..(N-1) only (through
commit, no anchor; anchor is for the next cycle). If -Cycles is 1, the only cycle runs
1..(N-1) (through commit, no anchor). Optional -CyclesPerChat K: after every K global
cycles a new chat starts; each K-th cycle ends after commit without the anchor step.
If -CyclesPerChat is 0 (default), one chat for the whole run (except the first prompt still starts without --continue).

Options:
  -PromptFile      Path to prompts (default: see below)
  -Workspace       Passed to agent --workspace (Cursor project root). Default: directory containing python/ and ui/ next to agent-queue/ (graph-caster layout); if parent of agent-queue/ is named scripts/, default is two levels up (legacy repo root); else parent of agent-queue/. Relative -Workspace resolves against that default root, then the agent-queue script directory.
  -AgentExe        Agent executable name or path (default: agent)
  -Model           Cursor model id for --model (default: composer-2 = Composer 2). Use composer-2-fast for Composer 2 Fast. Empty string = omit --model (CLI default).
  -Mode            agent | plan | ask (default: agent - pipeline edits code)
  -OutputFormat    text | json | stream-json (default: stream-json + partial deltas)
  -NoTrust         Do not pass --trust (default: trust this workspace for headless runs)
  -NoForce         Do not pass --force (default: --force so tools/shell do not block headless)
  -PipelineOrder   Force pipeline step order (requires >=3 blocks; see pipeline help above)
  -Sequential      File order 1..n; do not use pipeline order even for pipeline file
  -Cycles          Pipeline mode: how many cycles total (default: 1). Sequential mode (not pipeline): if N>1, same as -Loop with -MaxRounds N (that many loop rounds); N=1 = single pass.
  -CyclesPerChat    Pipeline mode: start a new chat every K cycles; end each K-th cycle
                    after the commit block (0 = one chat for all cycles)
  -ContinueFirstPrompt  First prompt of the run uses --continue (resume Cursor's last chat for this workspace).
                    Default: first prompt starts a new chat (no --continue). GUI: uncheck the first-prompt new-chat option to use --continue.
  -StallRestartSeconds  Full stall timer in seconds (default 800; 0 = timer off, manual restart only). Auto-restart when elapsed time since last monitor status write exceeds this value. Env AGENT_QUEUE_STALL_RESTART_SECONDS applies only when this argument is 0. Takes precedence over -StallRestartMinutes when >0.
  -StallRestartMinutes  If -StallRestartSeconds is 0 and this is >0: timer = N*60 seconds. Pass -StallRestartSeconds 0 to use minutes with the default seconds otherwise being 800. Env AGENT_QUEUE_STALL_RESTART_MINUTES.
  -StallRestartGraceSeconds  Ignored for stall timing (kept for script compatibility only). Env AGENT_QUEUE_STALL_RESTART_GRACE_SECONDS has no effect on the timer.
  -StallAllowManualRetry  Use the polling subprocess path so a flag file can request an immediate step restart (see agent-queue.manual-stall-retry.flag). GUI passes this; env AGENT_QUEUE_STALL_ALLOW_MANUAL=1.
  -Loop            Sequential mode (advanced): repeat like pipeline rounds; prefer -Cycles N instead of -Loop -MaxRounds N
  -MaxRounds       With -Loop only: stop after N full passes (0 = unlimited)
  -DelaySeconds    Pause between prompts
  -DryRun          Print agent invocations without running
  -AgentQueueSmokeTest  Self-test: long prompt triggers temp file + pwsh pipe-helper generation (does not run Cursor agent). Requires a readable -PromptFile (any valid queue file). Exit 0 on success.
  -InteractiveSetup  Interactive menu: pick a .txt from prompts/ next to this script, then cycles and cycles-per-chat (used by run-agent-queue.bat with no args)
  -InteractiveCycles  Ask for iteration count only (used by run-agent-queue.bat when args are passed without -Cycles; English prompt for console encoding)
  -HideThinking    With stream-json: do not print model thinking (reasoning) blocks
  -RawStreamJson    With stream-json: print raw NDJSON lines (no formatting)
  -StreamJsonInheritConsole  With stream-json: inherited console (no stdout pipe); raw NDJSON, no colors from agent-queue. Use if CLI exits 1 with empty output when stdout is redirected (some setups).
  -NoStreamJsonInheritConsole  Force stream-json to use stdout pipe + NDJSON parsing (default; same as unset inherit).
  -NoStreamColor    With stream-json: disable colored output (plain console text)
  -StreamBufferChars  Assistant text: buffer deltas before printing (default 256). 0 = print each delta (legacy).
  -StreamBufferIdleMs  If >0, flush buffered assistant text when gap between deltas exceeds this many ms (e.g. 400).
  -AssistantStreamDelta  Print assistant text incrementally as stream-json deltas arrive (default: off; final block only).
  -StartFromPrompt  1-based index of the prompt block to run first (default 1). Sequential: skip earlier blocks in the file. Pipeline: skip steps until the first step that uses that block; later cycles run full repeat order.
  Sequential loop rounds (-Cycles N with N>1, or -Loop): round 1 runs block 1 then 2..N (or StartFromPrompt..N if >1); round 2+ always runs blocks 2..N only (block 1 once per run, like pipeline).
  -SuperpowerBrainstormingPath  Optional path to brainstorming skill markdown (default: .\superpowers\brainstorming.md next to this script).
  -SuperpowerCodeReviewPath  Optional path to code-review skill markdown (default: .\superpowers\requesting-code-review.md next to this script).
  -SuperpowerWritingPlansPath  Optional path to writing-plans skill markdown (default: .\superpowers\writing-plans.md next to this script).
  -SuperpowerExecutingPlansPath  Optional path to executing-plans skill markdown (default: .\superpowers\executing-plans.md next to this script).
  Relative -PromptFile and -Superpower* paths resolve against this script's directory first, then against -Workspace if the file is not found there.
  -NoSuperpowerInject  Do not prepend Superpowers text when prompt starts with /brainstorming, /requesting-code-review, /writing-plans, or /executing-plans.
  Cooperative stop: if file agent-queue.finish-after-cycle.flag exists next to agent-queue.ps1 after a full pipeline cycle (or sequential round), the script exits before the next cycle/round. The GUI creates this file; the script deletes it when handling the stop.
  Manual step restart: if file agent-queue.manual-stall-retry.flag exists next to agent-queue.monitor-status.json (or next to agent-queue.ps1 when no monitor path), the next poll kills only the agent subprocess and restarts the step with the same prompt (same as stall watchdog). The GUI creates this file; the script deletes it when handling the request.
  Env AGENT_QUEUE_STREAM_JSON_INHERIT_CONSOLE: 1 = inherited console (no pipe); 0 or unset = pipe + formatted/colored NDJSON (default).
  Windows command-line limit (~8191 chars): if the estimated argv would exceed a safe threshold, the prompt is written to a temp file; the subprocess prefers node.exe + index.js with stdin (from the Cursor Agent install) and falls back to a helper PowerShell script (Get-Content | agent.ps1).
  On Windows, resolving "agent" may yield agent.cmd or agent.ps1 in %LOCALAPPDATA%\\cursor-agent\\; the script prefers cursor-agent.ps1 next to them when present (same as the intended CLI entry; avoids invoking the wrong launcher).
  The subprocess that runs cursor-agent.ps1 prefers pwsh.exe on PATH when present and not a Windows App Execution Alias shim (WindowsApps\pwsh.exe often exits immediately with no output); otherwise it uses pwsh.exe from $PSHOME (Core) or powershell.exe from $PSHOME (Desktop), e.g. when you started agent-queue.ps1 with Windows PowerShell 5.1 via run-agent-queue.bat.
  Injected skills are prefixed with "## Superpower: ..." (not a line starting with ---) so Cursor CLI does not treat the prompt as extra flags.

Prompt files:
  - agent-queue.prompts.local.txt (optional, gitignored) next to agent-queue.ps1 overrides everything if present
  - prompts/agent-queue.prompts.txt - default queue file (can be committed)
  - prompts/agent-queue.pipeline.prompts.txt - built-in pipeline if no prompts.txt / local
  - Lines starting with # are skipped. Multi-line prompts: separate blocks with
    a line containing only ---

Examples:
  .\agent-queue\run-agent-queue.bat
    (no args: interactive prompt file + cycles + cycles-per-chat; with args: forwarded; -Cycles in args skips iteration prompt)
  .\agent-queue\agent-queue.ps1 -Cycles 2
  .\agent-queue\agent-queue.ps1 -PromptFile .\agent-queue\prompts\agent-queue.pipeline.prompts.txt -Cycles 3 -Mode agent
  .\agent-queue\agent-queue.ps1 -Sequential -Cycles 3
  .\agent-queue\agent-queue.ps1 -StartFromPrompt 4 -Cycles 1
  .\agent-queue\agent-queue.ps1 -AgentQueueSmokeTest -PromptFile .\agent-queue\prompts\agent-queue.prompts.example.txt
  (In Aura monorepo: prefix paths with third_party\graph-caster\ or set -Workspace to graph-caster root.)
  .\tests\test_agent_queue_smoke.ps1   (same smoke from repo root; exit 0 = OK)

"@
}

if ($Help) {
    Show-AgentQueueHelp
    exit 0
}

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

function Get-AgentQueueDefaultWorkspaceRoot {
    param([string] $AgentQueueScriptDir)
    $parent = Split-Path -Parent $AgentQueueScriptDir
    if (-not $parent) {
        return (Resolve-Path -LiteralPath $AgentQueueScriptDir).Path
    }
    $py = Join-Path $parent "python"
    $ui = Join-Path $parent "ui"
    if ((Test-Path -LiteralPath $py) -and (Test-Path -LiteralPath $ui)) {
        return (Resolve-Path -LiteralPath $parent).Path
    }
    $leaf = Split-Path -Leaf $parent
    if ($leaf -ieq "scripts") {
        $twoUp = Join-Path $AgentQueueScriptDir "..\.."
        if (Test-Path -LiteralPath $twoUp) {
            return (Resolve-Path -LiteralPath $twoUp).Path
        }
    }
    return (Resolve-Path -LiteralPath $parent).Path
}

$script:AgentQueueFinishAfterCycleFlagPath = Join-Path $ScriptDir "agent-queue.finish-after-cycle.flag"
$script:AgentQueueMonitorStatusPath = $null
$script:AgentQueueLastMonitorStatusPayload = $null
$script:AgentQueueStallEpochUtc = $null
if ($env:AGENT_QUEUE_MONITOR_STATUS -and $env:AGENT_QUEUE_MONITOR_STATUS.Trim().Length -gt 0) {
    $script:AgentQueueMonitorStatusPath = $env:AGENT_QUEUE_MONITOR_STATUS.Trim()
    try {
        $script:AgentQueueMonitorStatusPath = [System.IO.Path]::GetFullPath($script:AgentQueueMonitorStatusPath)
    }
    catch {
    }
}
if (-not $ContinueFirstPrompt -and ($env:AGENT_QUEUE_CONTINUE_FIRST_PROMPT -eq '1' -or $env:AGENT_QUEUE_CONTINUE_FIRST_PROMPT -ieq 'true')) {
    $ContinueFirstPrompt = $true
}
if ($StallRestartSeconds -eq 0 -and $env:AGENT_QUEUE_STALL_RESTART_SECONDS -match '^\d+$') {
    $StallRestartSeconds = [int]$env:AGENT_QUEUE_STALL_RESTART_SECONDS
}
if ($StallRestartMinutes -eq 0 -and $env:AGENT_QUEUE_STALL_RESTART_MINUTES -match '^\d+$') {
    $StallRestartMinutes = [int]$env:AGENT_QUEUE_STALL_RESTART_MINUTES
}
if ($StallRestartGraceSeconds -eq 720 -and $env:AGENT_QUEUE_STALL_RESTART_GRACE_SECONDS -match '^\d+$') {
    $StallRestartGraceSeconds = [int]$env:AGENT_QUEUE_STALL_RESTART_GRACE_SECONDS
}
$script:AgentQueueStallRestartThresholdSeconds = 0
if ($StallRestartSeconds -gt 0) {
    $script:AgentQueueStallRestartThresholdSeconds = $StallRestartSeconds
}
elseif ($StallRestartMinutes -gt 0) {
    $script:AgentQueueStallRestartThresholdSeconds = $StallRestartMinutes * 60
}
if ($script:AgentQueueStallRestartThresholdSeconds -gt 0) {
    $stallCut = $script:AgentQueueStallRestartThresholdSeconds
    Write-Host ("[agent-queue] Stall watchdog: full timer {0}s; restart if last monitor-status write is older than {0}s." -f $stallCut) -ForegroundColor DarkGray
    if (-not $script:AgentQueueMonitorStatusPath) {
        Write-Host '[agent-queue] AGENT_QUEUE_MONITOR_STATUS is not set; stall timer cannot trigger. Use the Monitor GUI or set that env var to the absolute path of agent-queue.monitor-status.json next to agent-queue.ps1.' -ForegroundColor Yellow
    }
}
elseif ($script:AgentQueueMonitorStatusPath -or $StallAllowManualRetry) {
    Write-Host '[agent-queue] Auto-restart by stall timer is off: set -StallRestartSeconds > 0 (timer duration in seconds). Manual restart via flag still works.' -ForegroundColor Yellow
}
if (-not $StallAllowManualRetry -and $env:AGENT_QUEUE_STALL_ALLOW_MANUAL -eq '1') {
    $StallAllowManualRetry = $true
}

$script:AgentQueueManualStallRetryFlagPath = $null
if ($env:AGENT_QUEUE_MANUAL_STALL_FLAG -and $env:AGENT_QUEUE_MANUAL_STALL_FLAG.Trim().Length -gt 0) {
    $script:AgentQueueManualStallRetryFlagPath = $env:AGENT_QUEUE_MANUAL_STALL_FLAG.Trim()
}
elseif ($script:AgentQueueMonitorStatusPath) {
    $script:AgentQueueManualStallRetryFlagPath = Join-Path (Split-Path -Parent $script:AgentQueueMonitorStatusPath) 'agent-queue.manual-stall-retry.flag'
}
else {
    $script:AgentQueueManualStallRetryFlagPath = Join-Path $ScriptDir 'agent-queue.manual-stall-retry.flag'
}

$script:AgentQueueDebugLogPath = $null
$script:AgentQueueDebugLastStaleTrueUtc = $null
if ($env:AGENT_QUEUE_DEBUG_LOG_PATH -and $env:AGENT_QUEUE_DEBUG_LOG_PATH.Trim().Length -gt 0) {
    try {
        $script:AgentQueueDebugLogPath = [System.IO.Path]::GetFullPath($env:AGENT_QUEUE_DEBUG_LOG_PATH.Trim())
    }
    catch {
        $script:AgentQueueDebugLogPath = $env:AGENT_QUEUE_DEBUG_LOG_PATH.Trim()
    }
}

if ($script:AgentQueueDebugLogPath -and $env:AGENT_QUEUE_DEBUG_LOG_NO_RESET -ne '1') {
    try {
        [System.IO.File]::WriteAllText($script:AgentQueueDebugLogPath, '', [System.Text.UTF8Encoding]::new($false))
    }
    catch {
    }
}

function Write-AgentQueueDebugLog {
    param([string] $Message)
    $p = $script:AgentQueueDebugLogPath
    if (-not $p) {
        return
    }
    try {
        $line = ('{0} [ps] {1}' -f ([datetime]::UtcNow.ToString('o')), $Message)
        [System.IO.File]::AppendAllText($p, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    }
    catch {
    }
}

if ($script:AgentQueueDebugLogPath) {
    Write-AgentQueueDebugLog(('boot paths monitorStatus="{0}" flagPath="{1}" stallTimerSec={2} scriptDir="{3}"' -f `
            $script:AgentQueueMonitorStatusPath, $script:AgentQueueManualStallRetryFlagPath, $script:AgentQueueStallRestartThresholdSeconds, $ScriptDir))
}

$RepoRoot = Get-AgentQueueDefaultWorkspaceRoot -AgentQueueScriptDir $ScriptDir
if (-not $Workspace) {
    $Workspace = $RepoRoot
}
else {
    $wsArg = $Workspace.Trim()
    if (Test-Path -LiteralPath $wsArg) {
        $Workspace = (Resolve-Path -LiteralPath $wsArg).Path
    }
    elseif (-not [System.IO.Path]::IsPathRooted($wsArg)) {
        $tryFromDefault = Join-Path $RepoRoot $wsArg
        $tryFromScript = Join-Path $ScriptDir $wsArg
        if (Test-Path -LiteralPath $tryFromDefault) {
            $Workspace = (Resolve-Path -LiteralPath $tryFromDefault).Path
        }
        elseif (Test-Path -LiteralPath $tryFromScript) {
            $Workspace = (Resolve-Path -LiteralPath $tryFromScript).Path
        }
        else {
            $Workspace = (Resolve-Path -LiteralPath $wsArg).Path
        }
    }
    else {
        $Workspace = (Resolve-Path -LiteralPath $wsArg).Path
    }
}

Write-Host ('[agent-queue] Cursor --workspace: ' + $Workspace) -ForegroundColor DarkCyan

if ($InteractiveSetup) {
    $PromptsDirMenu = Join-Path $ScriptDir "prompts"
    if (-not (Test-Path -LiteralPath $PromptsDirMenu)) {
        New-Item -ItemType Directory -Path $PromptsDirMenu -Force | Out-Null
    }
    $promptFiles = @(Get-ChildItem -LiteralPath $PromptsDirMenu -Filter "*.txt" -File | Sort-Object Name)
    if ($promptFiles.Count -eq 0) {
        Write-Error "No prompt files (.txt) in: $PromptsDirMenu - add files or restore templates from the repo."
        exit 1
    }
    Write-Host ""
    Write-Host "Prompt files (prompts/):" -ForegroundColor Cyan
    for ($pi = 0; $pi -lt $promptFiles.Count; $pi++) {
        Write-Host ("  {0}. {1}" -f ($pi + 1), $promptFiles[$pi].Name)
    }
    $selRaw = Read-Host ("Select file number (1-{0})" -f $promptFiles.Count)
    $selNum = 0
    try {
        $selNum = [int]::Parse($selRaw.Trim())
    }
    catch {
        Write-Error "Invalid selection: not a number."
        exit 1
    }
    if ($selNum -lt 1 -or $selNum -gt $promptFiles.Count) {
        Write-Error ("Invalid selection: enter 1-{0}." -f $promptFiles.Count)
        exit 1
    }
    $PromptFile = $promptFiles[$selNum - 1].FullName

    $cRaw = Read-Host "Number of cycles [1]"
    if ([string]::IsNullOrWhiteSpace($cRaw)) {
        $Cycles = 1
    }
    else {
        try {
            $parsedC = [int]::Parse($cRaw.Trim())
            if ($parsedC -lt 1) {
                $Cycles = 1
            }
            else {
                $Cycles = $parsedC
            }
        }
        catch {
            Write-Warning "Invalid cycles, using 1."
            $Cycles = 1
        }
    }

    $kRaw = Read-Host "Cycles per chat (0 = one chat for all cycles) [0]"
    if ([string]::IsNullOrWhiteSpace($kRaw)) {
        $CyclesPerChat = 0
    }
    else {
        try {
            $parsedK = [int]::Parse($kRaw.Trim())
            if ($parsedK -lt 0) {
                $CyclesPerChat = 0
            }
            else {
                $CyclesPerChat = $parsedK
            }
        }
        catch {
            Write-Warning "Invalid number, using 0."
            $CyclesPerChat = 0
        }
    }
}

if ($InteractiveCycles -and -not $InteractiveSetup) {
    $r = Read-Host "Number of iterations [1]"
    if ([string]::IsNullOrWhiteSpace($r)) {
        $Cycles = 1
    }
    else {
        try {
            $parsed = [int]::Parse($r.Trim())
            if ($parsed -lt 1) {
                $Cycles = 1
            }
            else {
                $Cycles = $parsed
            }
        }
        catch {
            Write-Warning "Invalid number, using 1."
            $Cycles = 1
        }
    }
}

if (-not $PromptFile) {
    $PromptsDir = Join-Path $ScriptDir "prompts"
    $Personal = Join-Path $ScriptDir "agent-queue.prompts.local.txt"
    $DefaultPrompts = Join-Path $PromptsDir "agent-queue.prompts.txt"
    if (-not (Test-Path -LiteralPath $DefaultPrompts)) {
        $DefaultPrompts = Join-Path $ScriptDir "agent-queue.prompts.txt"
    }
    $Pipeline = Join-Path $PromptsDir "agent-queue.pipeline.prompts.txt"
    if (-not (Test-Path -LiteralPath $Pipeline)) {
        $Pipeline = Join-Path $ScriptDir "agent-queue.pipeline.prompts.txt"
    }
    $Example = Join-Path $PromptsDir "agent-queue.prompts.example.txt"
    if (-not (Test-Path -LiteralPath $Example)) {
        $Example = Join-Path $ScriptDir "agent-queue.prompts.example.txt"
    }
    if (Test-Path -LiteralPath $Personal) {
        $PromptFile = $Personal
    }
    elseif (Test-Path -LiteralPath $DefaultPrompts) {
        $PromptFile = $DefaultPrompts
    }
    elseif (Test-Path -LiteralPath $Pipeline) {
        $PromptFile = $Pipeline
    }
    elseif (Test-Path -LiteralPath $Example) {
        $PromptFile = $Example
    }
    else {
        Write-Error "No prompt file. Pass -PromptFile or add prompts/agent-queue.prompts.txt / prompts/agent-queue.pipeline.prompts.txt next to agent-queue.ps1"
    }
}
else {
    $pfTry = $PromptFile.Trim()
    if (-not (Test-Path -LiteralPath $pfTry)) {
        if (-not [System.IO.Path]::IsPathRooted($pfTry)) {
            $tryScript = Join-Path $ScriptDir $pfTry
            $tryPromptsSubdir = Join-Path (Join-Path $ScriptDir "prompts") $pfTry
            $tryWs = Join-Path $Workspace $pfTry
            $tryWsAqPrompts = Join-Path $Workspace (Join-Path "agent-queue" (Join-Path "prompts" $pfTry))
            if (Test-Path -LiteralPath $tryScript) {
                $pfTry = $tryScript
            }
            elseif (Test-Path -LiteralPath $tryPromptsSubdir) {
                $pfTry = $tryPromptsSubdir
            }
            elseif (Test-Path -LiteralPath $tryWs) {
                $pfTry = $tryWs
            }
            elseif (Test-Path -LiteralPath $tryWsAqPrompts) {
                $pfTry = $tryWsAqPrompts
            }
        }
    }
    if (-not (Test-Path -LiteralPath $pfTry)) {
        Write-Error "Prompt file not found: $PromptFile"
    }
    $PromptFile = (Resolve-Path -LiteralPath $pfTry).Path
}

function Get-AgentExecutable {
    param([string] $Name)
    if ($Name -match '[\\/]' -and (Test-Path -LiteralPath $Name)) {
        return (Resolve-Path $Name).Path
    }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }
    if ($Name -eq "agent" -and $env:LOCALAPPDATA) {
        $fallback = Join-Path $env:LOCALAPPDATA "cursor-agent\agent.cmd"
        if (Test-Path -LiteralPath $fallback) {
            return $fallback
        }
    }
    return $null
}

$AgentPath = Get-AgentExecutable -Name $AgentExe
if ($AgentPath -and ($AgentPath -match '(?i)[\\/]agent\.(cmd|ps1)$')) {
    $ps1Next = Join-Path (Split-Path $AgentPath -Parent) "cursor-agent.ps1"
    if (Test-Path -LiteralPath $ps1Next) {
        $AgentPath = $ps1Next
    }
}
if (-not $AgentPath -and -not $DryRun) {
    Write-Error "Cursor Agent CLI not found (`"$AgentExe`"). Install: irm 'https://cursor.com/install?win32=true' | iex"
}

function Join-PromptBlockLines {
    param([System.Collections.Generic.List[string]] $Buf)
    if ($Buf.Count -eq 0) {
        return ""
    }
    $filtered = New-Object System.Collections.Generic.List[string]
    foreach ($line in $Buf) {
        $t = $line.Trim()
        if ($t.Length -gt 0 -and $t.StartsWith("#")) {
            continue
        }
        $filtered.Add($line) | Out-Null
    }
    while ($filtered.Count -gt 0 -and $filtered[0].Trim().Length -eq 0) {
        $filtered.RemoveAt(0)
    }
    while ($filtered.Count -gt 0 -and $filtered[$filtered.Count - 1].Trim().Length -eq 0) {
        $filtered.RemoveAt($filtered.Count - 1)
    }
    if ($filtered.Count -eq 0) {
        return ""
    }
    return (($filtered -join "`n").Trim())
}

function Read-PromptLines {
    param([string] $Path)
    $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
    $hasSeparator = $false
    foreach ($line in $lines) {
        if ($line.Trim() -eq "---") {
            $hasSeparator = $true
            break
        }
    }
    if (-not $hasSeparator) {
        $out = New-Object System.Collections.Generic.List[string]
        foreach ($line in $lines) {
            $t = $line.Trim()
            if ($t.Length -eq 0) {
                continue
            }
            if ($t.StartsWith("#")) {
                continue
            }
            $out.Add($t) | Out-Null
        }
        if ($out.Count -eq 0) {
            Write-Error "No prompts in file (empty or only comments): $Path"
        }
        # Windows PowerShell: returning a one-element list unwraps to that element (string); ,@(...) keeps an array so $promptLines.Count works with Set-StrictMode.
        return ,@($out.ToArray())
    }
    $blocks = New-Object System.Collections.Generic.List[string]
    $buf = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        if ($line.Trim() -eq "---") {
            $joined = Join-PromptBlockLines -Buf $buf
            $buf = New-Object System.Collections.Generic.List[string]
            if ($joined.Length -gt 0) {
                $blocks.Add($joined) | Out-Null
            }
            continue
        }
        $buf.Add($line) | Out-Null
    }
    $last = Join-PromptBlockLines -Buf $buf
    if ($last.Length -gt 0) {
        $blocks.Add($last) | Out-Null
    }
    if ($blocks.Count -eq 0) {
        Write-Error "No prompts in file (empty or only separators): $Path"
    }
    return ,@($blocks.ToArray())
}

$promptLines = Read-PromptLines -Path $PromptFile
Write-Host ('[agent-queue] Prompt queue file: ' + $PromptFile) -ForegroundColor DarkCyan

function Remove-AgentMarkdownYamlFrontmatter {
    param([string]$Text)
    if ($Text -match '(?s)^\s*(?:<!--[\s\S]*?-->\s*)?---\r?\n[\s\S]*?\r?\n---\s*\r?\n') {
        return ($Text -replace '(?s)^\s*(?:<!--[\s\S]*?-->\s*)?---\r?\n[\s\S]*?\r?\n---\s*\r?\n', '').Trim()
    }
    return $Text
}

function Resolve-AgentQueueOptionalFilePath {
    param(
        [string] $UserPath,
        [string] $RelativeToScriptDir,
        [string] $RelativeToWorkspace
    )
    $t = if ($null -eq $UserPath) { "" } else { $UserPath.Trim() }
    if ($t.Length -eq 0) {
        return ""
    }
    if ([System.IO.Path]::IsPathRooted($t)) {
        if (Test-Path -LiteralPath $t) {
            return (Resolve-Path -LiteralPath $t).Path
        }
        return $t
    }
    $fromScript = Join-Path $RelativeToScriptDir $t
    if (Test-Path -LiteralPath $fromScript) {
        return (Resolve-Path -LiteralPath $fromScript).Path
    }
    $fromWs = Join-Path $RelativeToWorkspace $t
    if (Test-Path -LiteralPath $fromWs) {
        return (Resolve-Path -LiteralPath $fromWs).Path
    }
    return $fromScript
}

$script:SuperpowerBrainstormingBody = ""
$script:SuperpowerCodeReviewBody = ""
$script:SuperpowerWritingPlansBody = ""
$script:SuperpowerExecutingPlansBody = ""
if (-not $NoSuperpowerInject) {
    $defBrain = Join-Path $ScriptDir "superpowers\brainstorming.md"
    $defRev = Join-Path $ScriptDir "superpowers\requesting-code-review.md"
    $defWrite = Join-Path $ScriptDir "superpowers\writing-plans.md"
    $defExec = Join-Path $ScriptDir "superpowers\executing-plans.md"
    $pathBrain = if ($SuperpowerBrainstormingPath) {
        Resolve-AgentQueueOptionalFilePath -UserPath $SuperpowerBrainstormingPath -RelativeToScriptDir $ScriptDir -RelativeToWorkspace $Workspace
    }
    else {
        $defBrain
    }
    $pathRev = if ($SuperpowerCodeReviewPath) {
        Resolve-AgentQueueOptionalFilePath -UserPath $SuperpowerCodeReviewPath -RelativeToScriptDir $ScriptDir -RelativeToWorkspace $Workspace
    }
    else {
        $defRev
    }
    $pathWrite = if ($SuperpowerWritingPlansPath) {
        Resolve-AgentQueueOptionalFilePath -UserPath $SuperpowerWritingPlansPath -RelativeToScriptDir $ScriptDir -RelativeToWorkspace $Workspace
    }
    else {
        $defWrite
    }
    $pathExec = if ($SuperpowerExecutingPlansPath) {
        Resolve-AgentQueueOptionalFilePath -UserPath $SuperpowerExecutingPlansPath -RelativeToScriptDir $ScriptDir -RelativeToWorkspace $Workspace
    }
    else {
        $defExec
    }
    if (Test-Path -LiteralPath $pathBrain) {
        $rawB = (Get-Content -LiteralPath $pathBrain -Raw -Encoding UTF8).Trim()
        $script:SuperpowerBrainstormingBody = Remove-AgentMarkdownYamlFrontmatter -Text $rawB
    }
    else {
        Write-Warning "Superpower file not found: $pathBrain ( /brainstorming injection disabled)."
    }
    if (Test-Path -LiteralPath $pathRev) {
        $rawR = (Get-Content -LiteralPath $pathRev -Raw -Encoding UTF8).Trim()
        $script:SuperpowerCodeReviewBody = Remove-AgentMarkdownYamlFrontmatter -Text $rawR
    }
    else {
        Write-Warning "Superpower file not found: $pathRev ( /requesting-code-review injection disabled)."
    }
    if (Test-Path -LiteralPath $pathWrite) {
        $rawW = (Get-Content -LiteralPath $pathWrite -Raw -Encoding UTF8).Trim()
        $script:SuperpowerWritingPlansBody = Remove-AgentMarkdownYamlFrontmatter -Text $rawW
    }
    else {
        Write-Warning "Superpower file not found: $pathWrite ( /writing-plans injection disabled)."
    }
    if (Test-Path -LiteralPath $pathExec) {
        $rawE = (Get-Content -LiteralPath $pathExec -Raw -Encoding UTF8).Trim()
        $script:SuperpowerExecutingPlansBody = Remove-AgentMarkdownYamlFrontmatter -Text $rawE
    }
    else {
        Write-Warning "Superpower file not found: $pathExec ( /executing-plans injection disabled)."
    }
}

$pipelineFileName = [System.IO.Path]::GetFileName($PromptFile)
$usePipelineOrder = $false
if ($Sequential) {
    $usePipelineOrder = $false
}
elseif ($PipelineOrder) {
    $usePipelineOrder = $true
}
elseif ($pipelineFileName -ieq "agent-queue.pipeline.prompts.txt" -or $pipelineFileName -ieq "agent-queue.autotests.pipeline.prompts.txt" -or $pipelineFileName -ieq "agent-queue.general.pipeline.prompts.txt") {
    $usePipelineOrder = $true
}

if ($usePipelineOrder -and $Loop) {
    Write-Error "Pipeline mode does not use -Loop. Use -Cycles instead."
}

if ($usePipelineOrder -and $promptLines.Count -lt 3) {
    Write-Error "Pipeline order requires at least 3 prompt blocks separated by ---: first = chat start, last = next-cycle anchor, second-to-last = commit. Found $($promptLines.Count)."
}

if (-not $usePipelineOrder -and $CyclesPerChat -gt 0) {
    Write-Warning "agent-queue: -CyclesPerChat applies only in pipeline mode (-PipelineOrder or default pipeline file); value ignored."
}

if (-not $usePipelineOrder -and $Cycles -gt 1) {
    if ($Loop) {
        Write-Error "agent-queue: In sequential mode use either -Cycles N (N>1 for loop rounds) or -Loop with -MaxRounds, not both."
    }
    $Loop = $true
    $MaxRounds = $Cycles
    $Cycles = 1
}

if ($StartFromPrompt -gt $promptLines.Count) {
    Write-Error "StartFromPrompt ($StartFromPrompt) exceeds prompt block count ($($promptLines.Count))."
}

# Pipeline indices are 0-based: 0 = first block (new chat at session start); N-2 = commit; N-1 = anchor (next cycle).
# Order: first cycle of session = 0..N-1 (file order 1..N). Repeat cycles = 1..N-1 (blocks 2..N). Last global cycle or
# end of CyclesPerChat session = 1..N-2 (blocks 2..N-1 through commit, no anchor). Single global cycle (Cycles=1) = 0..N-2 (1..N-1 through commit, no anchor).
function Get-PipelineOrderForGlobalCycle {
    param(
        [int]$Cycles,
        [int]$CyclesPerChat,
        [int]$GlobalCycle,
        [int]$N
    )
    if ($N -lt 3) {
        Write-Error 'Pipeline requires N >= 3 blocks.'
    }
    if ($CyclesPerChat -le 0) {
        $cycleInSession = $GlobalCycle
    }
    else {
        $cycleInSession = (($GlobalCycle - 1) % $CyclesPerChat) + 1
    }
    $lastGlobal = ($GlobalCycle -eq $Cycles)
    $sessionEnd = ($CyclesPerChat -gt 0 -and $cycleInSession -eq $CyclesPerChat)
    if ($lastGlobal -and $Cycles -eq 1) {
        return @(0..($N - 2))
    }
    if ($lastGlobal -and $Cycles -gt 1) {
        if ($cycleInSession -eq 1) {
            return @(0..($N - 2))
        }
        return @(1..($N - 2))
    }
    if ($sessionEnd -and -not $lastGlobal) {
        if ($cycleInSession -eq 1) {
            return @(0..($N - 2))
        }
        return @(1..($N - 2))
    }
    if ($cycleInSession -eq 1) {
        return @(0..($N - 1))
    }
    return @(1..($N - 1))
}

function Expand-AgentPromptSuperpowers {
    param([string]$Prompt)
    if ($NoSuperpowerInject) {
        return $Prompt
    }
    $t = $Prompt.TrimStart()
    if ($t.Length -eq 0) {
        return $Prompt
    }
    $brain = $script:SuperpowerBrainstormingBody
    $rev = $script:SuperpowerCodeReviewBody
    $wplan = $script:SuperpowerWritingPlansBody
    $eplan = $script:SuperpowerExecutingPlansBody
    if ($t -match '^(?i)/brainstorming(\s|$)') {
        $rest = $t -replace '^(?i)/brainstorming\s*', ''
        if ($null -eq $brain -or $brain.Length -eq 0) {
            Write-Warning "Prompt starts with /brainstorming but skill file not loaded; sending task without injected skill."
            return $rest
        }
        return "## Superpower: brainstorming (injected)`n`n$brain`n`n--- User task ---`n`n$rest"
    }
    if ($t -match '^(?i)/requesting-code-review(\s|$)') {
        $rest = $t -replace '^(?i)/requesting-code-review\s*', ''
        if ($null -eq $rev -or $rev.Length -eq 0) {
            Write-Warning "Prompt starts with /requesting-code-review but skill file not loaded; sending task without injected skill."
            return $rest
        }
        return "## Superpower: requesting-code-review (injected)`n`n$rev`n`n--- User task ---`n`n$rest"
    }
    if ($t -match '^(?i)/writing-plans(\s|$)') {
        $rest = $t -replace '^(?i)/writing-plans\s*', ''
        if ($null -eq $wplan -or $wplan.Length -eq 0) {
            Write-Warning "Prompt starts with /writing-plans but skill file not loaded; sending task without injected skill."
            return $rest
        }
        return "## Superpower: writing-plans (injected)`n`n$wplan`n`n--- User task ---`n`n$rest"
    }
    if ($t -match '^(?i)/executing-plans(\s|$)') {
        $rest = $t -replace '^(?i)/executing-plans\s*', ''
        if ($null -eq $eplan -or $eplan.Length -eq 0) {
            Write-Warning "Prompt starts with /executing-plans but skill file not loaded; sending task without injected skill."
            return $rest
        }
        return "## Superpower: executing-plans (injected)`n`n$eplan`n`n--- User task ---`n`n$rest"
    }
    return $Prompt
}

function Get-AgentQueueInjectedSuperpowerName {
    param(
        [string] $OriginalPrompt,
        [string] $ExpandedPrompt
    )
    if ($OriginalPrompt -ceq $ExpandedPrompt) {
        return $null
    }
    if ($ExpandedPrompt -match '(?m)^## Superpower: (\S+) \(injected\)') {
        return $Matches[1]
    }
    return $null
}

function Add-AgentQueueCliFlagsAfterPrint {
    param(
        [System.Collections.Generic.List[string]] $List
    )
    $List.Add("--output-format") | Out-Null
    $List.Add($OutputFormat) | Out-Null
    if ($OutputFormat -eq "stream-json") {
        $List.Add("--stream-partial-output") | Out-Null
    }
    $List.Add("--workspace") | Out-Null
    $List.Add($Workspace) | Out-Null
    if (-not [string]::IsNullOrWhiteSpace($Model)) {
        $List.Add("--model") | Out-Null
        $List.Add($Model.Trim()) | Out-Null
    }
    if ($UseTrust) {
        $List.Add("--trust") | Out-Null
    }
    if ($UseForce) {
        $List.Add("--force") | Out-Null
    }
    if ($Mode -ne "agent") {
        $List.Add("--mode") | Out-Null
        $List.Add($Mode) | Out-Null
    }
}

function Build-AgentArgs {
    param(
        [bool] $Continue,
        [string] $Prompt
    )
    $a = New-Object System.Collections.Generic.List[string]
    if ($Continue) {
        $a.Add("--continue") | Out-Null
    }
    $a.Add("-p") | Out-Null
    $a.Add($Prompt) | Out-Null
    $a.Add("--print") | Out-Null
    Add-AgentQueueCliFlagsAfterPrint -List $a
    return $a.ToArray()
}

# Same flags as headless agent except prompt in argv: --continue (if needed), --print, then CLI flags. Long prompt uses StandardInput (temp file written before Start).
function Build-AgentArgsForStdin {
    param([bool] $Continue)
    $a = New-Object System.Collections.Generic.List[string]
    if ($Continue) {
        $a.Add("--continue") | Out-Null
    }
    $a.Add("--print") | Out-Null
    Add-AgentQueueCliFlagsAfterPrint -List $a
    return $a.ToArray()
}

# If argv would exceed the limit: UTF-8 temp file, argv without -p, prompt written to stdin after Start().
function Invoke-AgentQueueMaybeUseStdinPrompt {
    param(
        [string] $ExePath,
        [object[]] $ArgumentList,
        [string] $Prompt,
        [bool] $Continue
    )
    $est = Get-AgentQueueEstimatedCommandLineLength -ExePath $ExePath -ArgumentList $ArgumentList
    if ($est -le $script:AgentQueueMaxCmdLineChars) {
        return @{ Args = $ArgumentList; StdinPath = $null; PromptTempFilePath = $null }
    }
    $tmp = Join-Path $env:TEMP ("agent-queue-prompt-{0}.txt" -f [guid]::NewGuid().ToString('N'))
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($tmp, $Prompt, $utf8)
    $argsNo = Build-AgentArgsForStdin -Continue $Continue
    $estStdin = Get-AgentQueueEstimatedCommandLineLength -ExePath $ExePath -ArgumentList $argsNo
    if ($estStdin -gt $script:AgentQueueMaxCmdLineChars) {
        try {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        }
        catch {
        }
        throw ("agent-queue: argv without -p still exceeds command-line limit (est={0} chars, max={1}). Shorten --workspace, paths, or flags." -f $estStdin, $script:AgentQueueMaxCmdLineChars)
    }
    return @{ Args = $argsNo; StdinPath = $tmp; PromptTempFilePath = $tmp }
}

function Get-AgentQueuePromptPreviewLine {
    param(
        [string] $Text,
        [int] $Max = 80
    )
    $t = ($Text -replace "`r?`n", " ").Trim()
    if ($t.Length -gt $Max) {
        return $t.Substring(0, $Max) + "..."
    }
    return $t
}

function Write-AgentQueueMonitorStatusFile {
    param([hashtable] $Data)
    if (-not $script:AgentQueueMonitorStatusPath) {
        return
    }
    $Data['schemaVersion'] = 1
    $Data['updatedUtc'] = [DateTime]::UtcNow.ToString('o')
    try {
        $json = ($Data | ConvertTo-Json -Depth 8 -Compress)
        $p = $script:AgentQueueMonitorStatusPath
        $tmp = $p + '.tmp'
        $utf8Bom = [System.Text.UTF8Encoding]::new($true)
        [System.IO.File]::WriteAllText($tmp, $json, $utf8Bom)
        Move-Item -LiteralPath $tmp -Destination $p -Force
        $script:AgentQueueStallEpochUtc = [DateTime]::UtcNow
        $script:AgentQueueLastMonitorStatusPayload = @{}
        foreach ($k in $Data.Keys) {
            $script:AgentQueueLastMonitorStatusPayload[$k] = $Data[$k]
        }
        if ($script:AgentQueueDebugLogPath) {
            $ph = if ($Data.ContainsKey('phase')) { [string]$Data['phase'] } else { '?' }
            Write-AgentQueueDebugLog ('monitorJson written phase={0}' -f $ph)
        }
    }
    catch {
        Write-AgentQueueDebugLog ('monitorJson WRITE_FAIL {0}' -f $_)
    }
}

function Write-AgentQueueMonitorStatusFileSameStepRestart {
    param(
        [int]$AttemptNumber,
        [bool]$Manual
    )
    if (-not $script:AgentQueueMonitorStatusPath) {
        return
    }
    $base = $script:AgentQueueLastMonitorStatusPayload
    if ($null -eq $base -or $base.Count -lt 1) {
        try {
            Write-AgentQueueMonitorStatusFile @{
                phase = 'restarting_same_step'
                summaryLine = 'same-step restart (monitor payload not cached)'
                sameStepRetryAttempt = $AttemptNumber
                sameStepRestartReason = if ($Manual) { 'manual' } else { 'stall' }
            }
        }
        catch {
        }
        return
    }
    $h = @{}
    foreach ($k in $base.Keys) {
        $h[$k] = $base[$k]
    }
    $h['phase'] = 'restarting_same_step'
    $h['sameStepRetryAttempt'] = $AttemptNumber
    $h['sameStepRestartReason'] = if ($Manual) { 'manual' } else { 'stall' }
    Write-AgentQueueMonitorStatusFile $h
}

$script:AgentThinkingLineOpen = $false
$script:AgentStreamDeltaNoNewline = $false
$script:AgentAssistantTextBuffer = ""
$script:AgentAssistantLastDeltaUtc = $null
$script:AgentAssistantHadDeltaOutput = $false
$script:AgentQueueNoAssistantStreamDelta = $true
$script:AgentStreamBufferChars = 256
$script:AgentStreamBufferIdleMs = 0
$script:AgentQueueLastRunHadAnyProcessLine = $false
$script:AgentQueueLastRunInheritConsoleMode = $false

function Write-AgentQueueStepFailureDiagnostics {
    param([int]$ExitCode)
    if ($script:AgentQueueLastRunHadAnyProcessLine) {
        return
    }
    if ($script:AgentQueueLastRunInheritConsoleMode) {
        Write-Host ('[agent-queue] Agent exited with ' + $ExitCode + ' (inherited-console mode: this script did not read stdout; check NDJSON/errors printed above in this window). Typical causes: Cursor CLI auth, API key, model/subscription, or CLI error.') -ForegroundColor DarkYellow
    }
    else {
        Write-Host ('[agent-queue] Agent exited with ' + $ExitCode + ' before any stdout/stderr line (no NDJSON). Typical causes: not logged in to Cursor CLI, invalid/expired API key, model/subscription, or CLI error before streaming.') -ForegroundColor DarkYellow
    }
    if ($ExitCode -eq 5) {
        Write-Host '[agent-queue] Exit code 5 is ERROR_ACCESS_DENIED on Windows: run from a normal user session, check antivirus blocking agent.exe, or credential/key access.' -ForegroundColor DarkYellow
    }
    Write-Host '[agent-queue] Reproduce: agent-queue.ps1 -DryRun prints the argv; run that pwsh line in a terminal, or add -RawStreamJson for raw NDJSON.' -ForegroundColor DarkYellow
}

function Write-AgentQueueFailureDebugInfo {
    param(
        [string]$ExePath,
        [bool]$Continue,
        [string]$ExpandedPrompt,
        [int]$ExitCode
    )
    try {
        $agentArgList = Build-AgentArgs -Continue $Continue -Prompt $ExpandedPrompt
        $sum = 0
        foreach ($x in $agentArgList) {
            $sum += $x.Length
        }
        $sum += [math]::Max(0, $agentArgList.Length - 1)
        $wsLen = 0
        $wsPath = ""
        if ($null -ne $Workspace) {
            $wsPath = [string]$Workspace
            $wsLen = $wsPath.Length
        }
        $pl = 0
        if ($null -ne $ExpandedPrompt) {
            $pl = $ExpandedPrompt.Length
        }
        $hasApiKey = $false
        if ($env:CURSOR_API_KEY -and $env:CURSOR_API_KEY.Length -gt 0) {
            $hasApiKey = $true
        }
        if ($ExitCode -eq 1 -and -not $hasApiKey) {
            Write-Host '[agent-queue] Hint: exit 1 with no output usually means the Cursor CLI is not authenticated for this process.' -ForegroundColor Cyan
            Write-Host '[agent-queue] Hint: in a terminal run: agent login   then: agent status   (same Cursor account as the IDE if you use the IDE).' -ForegroundColor Cyan
            Write-Host '[agent-queue] Hint: for automation without interactive login, set environment variable CURSOR_API_KEY (see Cursor CLI docs).' -ForegroundColor Cyan
        }
        elseif ($ExitCode -eq 1 -and $hasApiKey) {
            Write-Host '[agent-queue] Hint: exit 1 with CURSOR_API_KEY set - verify the key, model (-Model), subscription, or run agent status.' -ForegroundColor Cyan
        }
        if ($script:AgentQueueLastRunInheritConsoleMode) {
            Write-Host '[agent-queue] Debug: Inherited-console mode did not capture stdout in this script; scroll up for CLI output.' -ForegroundColor DarkYellow
        }
        else {
            Write-Host '[agent-queue] Debug: Empty stdout/stderr from the redirected pipe usually means the CLI quit before streaming (auth/session/API), not a missing console line.' -ForegroundColor DarkYellow
        }
        Write-Host ('[agent-queue] Debug: ExePath=' + $ExePath + ' exists=' + (Test-Path -LiteralPath $ExePath) + ' exit=' + $ExitCode) -ForegroundColor DarkYellow
        Write-Host ('[agent-queue] Debug: Workspace len={0} path={1}' -f $wsLen, $wsPath) -ForegroundColor DarkYellow
        Write-Host ('[agent-queue] Debug: -p prompt len={0}; argv char sum ~{1} (if near 32767, Windows may reject the command line)' -f $pl, $sum) -ForegroundColor DarkYellow
        $agentDir = Split-Path -Parent $ExePath
        $nodeLocal = Join-Path $agentDir 'node.exe'
        $versDir = Join-Path $agentDir 'versions'
        $hasVerNode = $false
        if (Test-Path -LiteralPath $versDir) {
            $verSub = Get-ChildItem -LiteralPath $versDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
            if ($verSub) {
                $hasVerNode = Test-Path -LiteralPath (Join-Path $verSub.FullName 'node.exe')
            }
        }
        Write-Host ('[agent-queue] Debug: node.exe beside launcher={0}; versions dir={1}; versions subtree node.exe (newest name)={2}' -f (Test-Path -LiteralPath $nodeLocal), (Test-Path -LiteralPath $versDir), $hasVerNode) -ForegroundColor DarkYellow
        Write-Host ('[agent-queue] Debug: CURSOR_API_KEY set={0} (set it for unattended runs; otherwise use agent login in a terminal)' -f $hasApiKey) -ForegroundColor DarkYellow
        Write-Host '[agent-queue] Debug: Run -DryRun to print argv; run that same pwsh -File ... line manually to see any CLI errors.' -ForegroundColor DarkYellow
    }
    catch {
        Write-Host ('[agent-queue] Debug: failed to print diagnostics: {0}' -f $_.Exception.Message) -ForegroundColor DarkYellow
    }
}

function Flush-AgentAssistantBufferForContextSwitch {
    param([bool]$NoColor)
    if ($script:AgentAssistantTextBuffer.Length -eq 0) {
        return
    }
    $buf = $script:AgentAssistantTextBuffer
    $script:AgentAssistantTextBuffer = ""
    Write-AgentAssistantFinalParagraphs -Text $buf -NoColor $NoColor
    $script:AgentStreamDeltaNoNewline = $false
}

function Write-AgentAssistantBufferedDelta {
    param(
        [string]$Text,
        [bool]$NoColor
    )
    $min = $script:AgentStreamBufferChars
    $idle = $script:AgentStreamBufferIdleMs
    if ($min -le 0) {
        Write-AgentStreamHost -Text $Text -Color Gray -NoNewline:$true -NoColor $NoColor
        $script:AgentStreamDeltaNoNewline = $true
        return
    }
    if ($idle -gt 0 -and $script:AgentAssistantTextBuffer.Length -gt 0 -and $null -ne $script:AgentAssistantLastDeltaUtc) {
        if (([DateTime]::UtcNow - $script:AgentAssistantLastDeltaUtc).TotalMilliseconds -ge $idle) {
            $flush = $script:AgentAssistantTextBuffer
            $script:AgentAssistantTextBuffer = ""
            Write-AgentStreamHost -Text $flush -Color Gray -NoNewline:$true -NoColor $NoColor
        }
    }
    $script:AgentAssistantTextBuffer += $Text
    $script:AgentAssistantLastDeltaUtc = [DateTime]::UtcNow
    $script:AgentStreamDeltaNoNewline = $true
    while ($true) {
        $buf = $script:AgentAssistantTextBuffer
        if ($buf.Length -eq 0) {
            break
        }
        $nlIdx = $buf.IndexOf([char]10)
        if ($nlIdx -ge 0) {
            $line = $buf.Substring(0, $nlIdx + 1)
            $script:AgentAssistantTextBuffer = $buf.Substring($nlIdx + 1)
            Write-AgentStreamHost -Text $line -Color Gray -NoNewline:$false -NoColor $NoColor
            continue
        }
        if ($buf.Length -ge $min) {
            $chunk = $buf.Substring(0, $min)
            $script:AgentAssistantTextBuffer = $buf.Substring($min)
            Write-AgentStreamHost -Text $chunk -Color Gray -NoNewline:$true -NoColor $NoColor
            continue
        }
        break
    }
}

function Close-AgentThinkingBlock {
    if ($script:AgentThinkingLineOpen) {
        Write-Host ""
        if (-not $script:AgentQueueNoStreamColor) {
            Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
        }
        else {
            Write-Host "  ----------------------------------------"
        }
        Write-Host ""
        $script:AgentThinkingLineOpen = $false
    }
}

function Close-AgentStreamDeltaIfNeeded {
    $nc = $script:AgentQueueNoStreamColor
    if ($script:AgentAssistantTextBuffer.Length -gt 0) {
        Flush-AgentAssistantBufferForContextSwitch -NoColor $nc
        return
    }
    if ($script:AgentStreamDeltaNoNewline) {
        Write-Host ""
        $script:AgentStreamDeltaNoNewline = $false
    }
}

function Write-AgentAssistantFinalParagraphs {
    param(
        [string] $Text,
        [bool] $NoColor
    )
    if ($null -eq $Text -or $Text.Length -eq 0) {
        return
    }
    foreach ($ln in ($Text -split "`r?`n", -1, 'Regex')) {
        Write-AgentStreamHost -Text $ln -Color Gray -NoNewline:$false -NoColor $NoColor
    }
}

function Write-AgentStreamHost {
    param(
        [string] $Text,
        [ConsoleColor] $Color,
        [bool] $NoNewline,
        [bool] $NoColor
    )
    if ($NoColor) {
        if ($NoNewline) {
            Write-Host $Text -NoNewline
        }
        else {
            Write-Host $Text
        }
    }
    else {
        if ($NoNewline) {
            Write-Host $Text -NoNewline -ForegroundColor $Color
        }
        else {
            Write-Host $Text -ForegroundColor $Color
        }
    }
}

function Get-AgentToolCallKind {
    param([object] $ToolCall)
    if ($null -eq $ToolCall) {
        return "other"
    }
    $names = @($ToolCall.PSObject.Properties.Name)
    foreach ($k in @("readToolCall", "grepToolCall", "lsToolCall", "globToolCall")) {
        if ($names -contains $k) {
            return "read"
        }
    }
    foreach ($k in @("writeToolCall", "deleteToolCall")) {
        if ($names -contains $k) {
            return "write"
        }
    }
    if ($names -contains "editToolCall") {
        return "edit"
    }
    if ($names -contains "shellToolCall") {
        return "shell"
    }
    foreach ($k in @("todoToolCall", "updateTodosToolCall")) {
        if ($names -contains $k) {
            return "todo"
        }
    }
    return "other"
}

function Get-AgentToolCallStartedSummary {
    param([object] $ToolCall)
    if ($null -eq $ToolCall) {
        return '[tool]'
    }
    $names = @($ToolCall.PSObject.Properties.Name)
    foreach ($pair in @(
            @{ N = "readToolCall"; F = { param($i) '[read] ' + $i.args.path } },
            @{ N = "grepToolCall"; F = { param($i) '[grep] ' + $i.args.pattern + ' @ ' + $i.args.path } },
            @{ N = "lsToolCall"; F = { param($i) '[ls] ' + $i.args.path } },
            @{ N = "globToolCall"; F = { param($i) '[glob] ' + $i.args.globPattern + ' in ' + $i.args.targetDirectory } },
            @{ N = "writeToolCall"; F = { param($i) '[write] ' + $i.args.path } },
            @{ N = "editToolCall"; F = { param($i) '[edit] ' + $i.args.path } },
            @{ N = "deleteToolCall"; F = { param($i) '[delete] ' + $i.args.path } },
            @{ N = "shellToolCall"; F = {
                    param($i)
                    $c = [string]$i.args.command
                    if ($c.Length -gt 140) {
                        $c = $c.Substring(0, 137) + "..."
                    }
                    return '[shell] ' + $c
                }
            }
        )) {
        if ($names -contains $pair.N) {
            $inner = $ToolCall.($pair.N)
            if ($inner) {
                try {
                    return & $pair.F $inner
                }
                catch {
                    return '[tool] ' + $pair.N
                }
            }
        }
    }
    if ($names.Count -gt 0) {
        return '[tool] ' + $names[0]
    }
    return '[tool]'
}

function Get-AgentToolCallResultSuccess {
    param([object] $InnerToolCall)
    if ($null -eq $InnerToolCall -or $null -eq $InnerToolCall.result) {
        return $null
    }
    $res = $InnerToolCall.result
    $rn = @($res.PSObject.Properties.Name)
    if (-not ($rn -contains "success")) {
        return $null
    }
    return $res.success
}

function Get-AgentToolCallCompletedSummary {
    param([object] $ToolCall)
    if ($null -eq $ToolCall) {
        return '[done]'
    }
    $names = @($ToolCall.PSObject.Properties.Name)
    if ($names -contains "readToolCall") {
        $r = $ToolCall.readToolCall
        $s = Get-AgentToolCallResultSuccess -InnerToolCall $r
        if ($null -ne $s) {
            $sn = @($s.PSObject.Properties.Name)
            if ($sn -contains "totalLines" -and $null -ne $s.totalLines) {
                return '[read] ' + $s.totalLines + ' lines'
            }
        }
        return '[read] done'
    }
    if ($names -contains "writeToolCall") {
        $r = $ToolCall.writeToolCall
        $s = Get-AgentToolCallResultSuccess -InnerToolCall $r
        if ($null -ne $s) {
            $sn = @($s.PSObject.Properties.Name)
            $lc = if ($sn -contains "linesCreated") { $s.linesCreated } else { $null }
            $fs = if ($sn -contains "fileSize") { $s.fileSize } else { $null }
            if ($null -ne $lc -or $null -ne $fs) {
                return '[write] ' + $lc + ' lines, ' + $fs + ' bytes'
            }
        }
        return '[write] done'
    }
    if ($names -contains "editToolCall") {
        return '[edit] done'
    }
    if ($names -contains "shellToolCall") {
        $r = $ToolCall.shellToolCall
        $s = Get-AgentToolCallResultSuccess -InnerToolCall $r
        if ($null -ne $s) {
            $sn = @($s.PSObject.Properties.Name)
            if ($sn -contains "exitCode") {
                return '[shell] exit ' + $s.exitCode
            }
        }
        return '[shell] failed'
    }
    if ($names -contains "grepToolCall") {
        return '[grep] done'
    }
    if ($names -contains "lsToolCall") {
        return '[ls] done'
    }
    if ($names -contains "globToolCall") {
        return '[glob] done'
    }
    if ($names -contains "deleteToolCall") {
        return '[delete] done'
    }
    return '[done]'
}

function Get-AgentToolCallColor {
    param([string] $Kind)
    switch ($Kind) {
        "read" { return [ConsoleColor]::Cyan }
        "write" { return [ConsoleColor]::Green }
        "edit" { return [ConsoleColor]::Green }
        "shell" { return [ConsoleColor]::Yellow }
        "todo" { return [ConsoleColor]::DarkCyan }
        default { return [ConsoleColor]::DarkYellow }
    }
}

function Get-AgentAssistantTextFromEvent {
    param([object] $obj)
    if ($obj.PSObject.Properties.Name -contains "text" -and $null -ne $obj.text -and ($obj.text -is [string]) -and $obj.text.Length -gt 0) {
        return $obj.text
    }
    if ($obj.PSObject.Properties.Name -contains "message" -and $null -ne $obj.message) {
        $msg = $obj.message
        if ($msg.PSObject.Properties.Name -contains "content" -and $null -ne $msg.content) {
            $parts = New-Object System.Collections.Generic.List[string]
            foreach ($c in $msg.content) {
                if ($null -ne $c -and $c.PSObject.Properties.Name -contains "text" -and $null -ne $c.text) {
                    $parts.Add([string]$c.text) | Out-Null
                }
            }
            if ($parts.Count -gt 0) {
                return [string]::Join("", $parts)
            }
        }
    }
    return ""
}

function Write-AgentStreamJsonLine {
    param(
        [string] $Line,
        [bool] $HideThinking
    )
    $t = $Line.Trim()
    if ($t.Length -eq 0) {
        return
    }
    $obj = $null
    try {
        $obj = $t | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        Write-Host $Line
        return
    }
    if (-not ($obj.PSObject.Properties.Name -contains "type")) {
        Write-Host $Line
        return
    }
    $nc = $script:AgentQueueNoStreamColor
    if ($obj.type -eq "thinking" -or $obj.type -eq "reasoning") {
        $thinkingLabel = if ($obj.type -eq "reasoning") { "Reasoning" } else { "Thinking" }
        if ($HideThinking) {
            return
        }
        Close-AgentStreamDeltaIfNeeded
        $hasText = $obj.PSObject.Properties.Name -contains "text" -and $null -ne $obj.text -and ($obj.text -is [string]) -and $obj.text.Length -gt 0
        if (-not $hasText) {
            return
        }
        $isDelta = $obj.PSObject.Properties.Name -contains "subtype" -and $obj.subtype -eq "delta"
        if ($isDelta) {
            if (-not $script:AgentThinkingLineOpen) {
                Write-Host ""
                Write-AgentStreamHost -Text ("  " + $thinkingLabel) -Color DarkYellow -NoNewline:$false -NoColor $nc
                if (-not $nc) {
                    Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
                }
                else {
                    Write-Host "  ----------------------------------------"
                }
                Write-AgentStreamHost -Text "  " -Color DarkGray -NoNewline:$true -NoColor $nc
                $script:AgentThinkingLineOpen = $true
            }
            Write-AgentStreamHost -Text $obj.text -Color DarkGray -NoNewline:$true -NoColor $nc
        }
        else {
            Close-AgentThinkingBlock
            Write-Host ""
            Write-AgentStreamHost -Text ("  " + $thinkingLabel) -Color DarkYellow -NoNewline:$false -NoColor $nc
            if (-not $nc) {
                Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
            }
            else {
                Write-Host "  ----------------------------------------"
            }
            Write-AgentStreamHost -Text "  $($obj.text)" -Color DarkGray -NoNewline:$false -NoColor $nc
            if (-not $nc) {
                Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
            }
            else {
                Write-Host "  ----------------------------------------"
            }
            Write-Host ""
        }
        return
    }
    Close-AgentThinkingBlock
    $st = $null
    if ($obj.PSObject.Properties.Name -contains "subtype") {
        $st = $obj.subtype
    }
    if ($obj.type -eq "tool_call" -and $obj.PSObject.Properties.Name -contains "tool_call") {
        Close-AgentStreamDeltaIfNeeded
        $script:AgentAssistantHadDeltaOutput = $false
        $kind = Get-AgentToolCallKind -ToolCall $obj.tool_call
        $tcColor = Get-AgentToolCallColor -Kind $kind
        if ($st -eq "started") {
            if ($script:AgentStreamJsonToolStartedCount -gt 0) {
                Write-Host ""
            }
            $summary = Get-AgentToolCallStartedSummary -ToolCall $obj.tool_call
            Write-AgentStreamHost -Text "  $summary" -Color $tcColor -NoNewline:$false -NoColor $nc
            $script:AgentStreamJsonToolStartedCount++
        }
        elseif ($st -eq "completed") {
            $summary = Get-AgentToolCallCompletedSummary -ToolCall $obj.tool_call
            Write-AgentStreamHost -Text "  $summary" -Color DarkGray -NoNewline:$false -NoColor $nc
            Write-Host ""
        }
        else {
            $short = $t
            if ($short.Length -gt 160) {
                $short = $short.Substring(0, 157) + "..."
            }
            Write-AgentStreamHost -Text ('[tool_call ' + $st + '] ' + $short) -Color DarkYellow -NoNewline:$false -NoColor $nc
        }
        $script:AgentStreamDeltaNoNewline = $false
        return
    }
    if ($obj.type -eq "system") {
        Close-AgentStreamDeltaIfNeeded
        $script:AgentAssistantHadDeltaOutput = $false
        $cwd = ""
        if ($obj.PSObject.Properties.Name -contains "cwd") {
            $cwd = [string]$obj.cwd
        }
        $model = ""
        if ($obj.PSObject.Properties.Name -contains "model") {
            $model = [string]$obj.model
        }
        Write-AgentStreamHost -Text ('  [system] ' + $model + ' ' + $cwd) -Color DarkGray -NoNewline:$false -NoColor $nc
        return
    }
    if ($obj.type -eq "user") {
        Close-AgentStreamDeltaIfNeeded
        $script:AgentAssistantHadDeltaOutput = $false
        $ut = Get-AgentAssistantTextFromEvent -obj $obj
        if ($ut.Length -gt 200) {
            $ut = $ut.Substring(0, 197) + "..."
        }
        $ut = $ut -replace "`r?`n", " "
        Write-AgentStreamHost -Text ('  [user] ' + $ut) -Color DarkCyan -NoNewline:$false -NoColor $nc
        return
    }
    if ($obj.type -eq "result") {
        Close-AgentStreamDeltaIfNeeded
        $script:AgentAssistantHadDeltaOutput = $false
        $dur = ""
        if ($obj.PSObject.Properties.Name -contains "duration_ms") {
            $dur = "$($obj.duration_ms)ms"
        }
        $sub = ""
        if ($obj.PSObject.Properties.Name -contains "subtype") {
            $sub = [string]$obj.subtype
        }
        Write-AgentStreamHost -Text ('  [result] ' + $sub + ' ' + $dur) -Color Magenta -NoNewline:$false -NoColor $nc
        return
    }
    if ($obj.type -eq "connection") {
        Close-AgentStreamDeltaIfNeeded
        $script:AgentAssistantHadDeltaOutput = $false
        $sid = ""
        if ($obj.PSObject.Properties.Name -contains "session_id") {
            $sid = [string]$obj.session_id
            if ($sid.Length -gt 13) {
                $sid = $sid.Substring(0, 8) + "..."
            }
        }
        $sub = if ($null -ne $st) { [string]$st } else { "?" }
        $msg = '  [connection] ' + $sub
        if ($sid.Length -gt 0) {
            $msg += ' | ' + $sid
        }
        Write-AgentStreamHost -Text $msg -Color DarkGray -NoNewline:$false -NoColor $nc
        return
    }
    if ($obj.type -eq "retry") {
        Close-AgentStreamDeltaIfNeeded
        $script:AgentAssistantHadDeltaOutput = $false
        $sub = if ($null -ne $st) { [string]$st } else { "?" }
        $extra = ""
        if ($obj.PSObject.Properties.Name -contains "attempt") {
            $extra += " | attempt " + $obj.attempt
        }
        if ($obj.PSObject.Properties.Name -contains "is_resume") {
            $extra += " | resume=" + $obj.is_resume
        }
        Write-AgentStreamHost -Text ('  [retry] ' + $sub + $extra) -Color DarkGray -NoNewline:$false -NoColor $nc
        return
    }
    $assistantText = Get-AgentAssistantTextFromEvent -obj $obj
    if ($assistantText.Length -gt 0) {
        if ($st -eq "delta") {
            if ($script:AgentQueueNoAssistantStreamDelta) {
                $script:AgentAssistantTextBuffer += $assistantText
                $script:AgentAssistantLastDeltaUtc = [DateTime]::UtcNow
            }
            else {
                $script:AgentAssistantHadDeltaOutput = $true
                Write-AgentAssistantBufferedDelta -Text $assistantText -NoColor $nc
            }
        }
        elseif ($script:AgentQueueNoAssistantStreamDelta) {
            $script:AgentAssistantTextBuffer = ""
            Write-AgentAssistantFinalParagraphs -Text $assistantText -NoColor $nc
            $script:AgentStreamDeltaNoNewline = $false
        }
        else {
            Flush-AgentAssistantBufferForContextSwitch -NoColor $nc
            if (-not $script:AgentAssistantHadDeltaOutput) {
                Write-AgentAssistantFinalParagraphs -Text $assistantText -NoColor $nc
            }
            $script:AgentStreamDeltaNoNewline = $false
            $script:AgentAssistantHadDeltaOutput = $false
        }
        return
    }
    Close-AgentStreamDeltaIfNeeded
    $script:AgentStreamDeltaNoNewline = $false
    $short = $t
    if ($short.Length -gt 160) {
        $short = $short.Substring(0, 157) + "..."
    }
    Write-AgentStreamHost -Text ('[' + $obj.type + '] ' + $short) -Color DarkCyan -NoNewline:$false -NoColor $nc
}

function Get-AgentLastExitCode {
    $e = $LASTEXITCODE
    if ($null -eq $e) {
        return 0
    }
    try {
        return [int]$e
    }
    catch {
        return 0
    }
}

function Protect-AgentProcessArgumentPart {
    param([string] $Part)
    if ($Part -match '[\s"]') {
        '"' + ($Part -replace '"', '""') + '"'
    }
    else {
        $Part
    }
}

function Join-AgentProcessArguments {
    param([string[]] $Parts)
    if ($null -eq $Parts -or $Parts.Length -eq 0) {
        return ""
    }
    ($Parts | ForEach-Object { Protect-AgentProcessArgumentPart -Part $_ }) -join ' '
}

# Estimated argv length for CreateProcess (pwsh -File, args, quoting) compared to AgentQueueMaxCmdLineChars.
function Get-AgentQueueEstimatedCommandLineLength {
    param(
        [string] $ExePath,
        [object[]] $ArgumentList
    )
    $parts = [System.Collections.Generic.List[string]]::new()
    if ($ExePath -match '\.ps1\s*$') {
        $pwsh = Resolve-AgentQueuePwshPath
        $parts.Add($pwsh) | Out-Null
        $parts.Add('-NoProfile') | Out-Null
        $parts.Add('-ExecutionPolicy') | Out-Null
        $parts.Add('Bypass') | Out-Null
        $parts.Add('-File') | Out-Null
        $parts.Add($ExePath) | Out-Null
        foreach ($a in $ArgumentList) {
            $parts.Add([string]$a) | Out-Null
        }
    }
    else {
        $parts.Add($ExePath) | Out-Null
        foreach ($a in $ArgumentList) {
            $parts.Add([string]$a) | Out-Null
        }
    }
    return (Join-AgentProcessArguments -Parts $parts.ToArray()).Length
}

function Test-AgentQueuePathIsWindowsAppsPwshShim {
    param([string] $Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }
    if ($Path -match '(?i)\\WindowsApps\\') {
        return $true
    }
    if ($Path -match '(?i)\\AppData\\Local\\Microsoft\\WindowsApps\\') {
        return $true
    }
    return $false
}

function Resolve-AgentQueuePwshPath {
    $fromPath = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($fromPath) {
        $candidate = $fromPath.Source
        if (-not (Test-AgentQueuePathIsWindowsAppsPwshShim -Path $candidate)) {
            return $candidate
        }
    }
    $pwsh = if ($PSVersionTable.PSEdition -eq 'Core') {
        Join-Path $PSHOME 'pwsh.exe'
    }
    else {
        Join-Path $PSHOME 'powershell.exe'
    }
    if (-not (Test-Path -LiteralPath $pwsh)) {
        $pwsh = (Get-Command powershell -ErrorAction Stop).Source
    }
    return $pwsh
}

function Parse-AgentQueueCursorVersionDirSortKey {
    param([string]$VersionString)
    try {
        $datePart = $VersionString.Split('-')[0]
        $parts = $datePart.Split('.')
        if ($parts.Length -ne 3) {
            return 0
        }
        $year = $parts[0]
        $month = $parts[1].PadLeft(2, '0')
        $day = $parts[2].PadLeft(2, '0')
        return [int]($year + $month + $day)
    }
    catch {
        return 0
    }
}

function Resolve-AgentQueueCursorAgentNodeExeAndIndexJs {
    param([string]$AgentExePath)
    if ([string]::IsNullOrWhiteSpace($AgentExePath) -or -not (Test-Path -LiteralPath $AgentExePath)) {
        return $null
    }
    $scriptPath = Split-Path -Parent $AgentExePath
    $nodeLocal = Join-Path $scriptPath 'node.exe'
    $indexLocal = Join-Path $scriptPath 'index.js'
    if ((Test-Path -LiteralPath $nodeLocal) -and (Test-Path -LiteralPath $indexLocal)) {
        return @{ NodeExe = $nodeLocal; IndexJs = $indexLocal }
    }
    $versionsDir = Join-Path $scriptPath 'versions'
    if (-not (Test-Path -LiteralPath $versionsDir)) {
        return $null
    }
    $candidates = @(Get-ChildItem -Path $versionsDir -Directory -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -match '^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$'
    })
    if ($candidates.Count -eq 0) {
        return $null
    }
    $versionDir = $candidates | Sort-Object { Parse-AgentQueueCursorVersionDirSortKey -VersionString $_.Name } -Descending | Select-Object -First 1
    if ($null -eq $versionDir) {
        return $null
    }
    $ver = $versionDir.FullName
    $nodeV = Join-Path $ver 'node.exe'
    $indexV = Join-Path $ver 'index.js'
    if ((Test-Path -LiteralPath $nodeV) -and (Test-Path -LiteralPath $indexV)) {
        return @{ NodeExe = $nodeV; IndexJs = $indexV }
    }
    return $null
}

function Escape-AgentPipeScriptSingleQuoted {
    param([string] $Text)
    if ($null -eq $Text) {
        return ""
    }
    return $Text.Replace("'", "''")
}

function New-AgentPipeRunnerScriptFile {
    param(
        [string] $PromptFilePath,
        [string] $AgentExePath,
        [object[]] $AgentArgs
    )
    $pwshPath = Resolve-AgentQueuePwshPath
    $pe = Escape-AgentPipeScriptSingleQuoted -Text $PromptFilePath
    $ae = Escape-AgentPipeScriptSingleQuoted -Text $AgentExePath
    $pp = Escape-AgentPipeScriptSingleQuoted -Text $pwshPath
    $argStrs = New-Object System.Collections.Generic.List[string]
    foreach ($a in $AgentArgs) {
        $aes = Escape-AgentPipeScriptSingleQuoted -Text ([string]$a)
        $argStrs.Add("'$aes'") | Out-Null
    }
    $argsLiteral = $argStrs -join ', '
    $lines = @(
        '$ErrorActionPreference = "Stop"',
        "`$PromptFilePath = '$pe'",
        "`$AgentExePath = '$ae'",
        "`$PwshPath = '$pp'",
        "`$AgentArgs = @($argsLiteral)",
        '$p = Get-Content -LiteralPath $PromptFilePath -Raw -Encoding utf8',
        'if ($AgentExePath -like ''*.ps1'') {',
        '    $p | & $PwshPath -NoProfile -ExecutionPolicy Bypass -File $AgentExePath @AgentArgs',
        '}',
        'else {',
        '    $p | & $AgentExePath @AgentArgs',
        '}',
        'exit $LASTEXITCODE'
    )
    $txt = [string]::Join("`n", $lines)
    $scriptTmp = Join-Path $env:TEMP ("agent-queue-pipe-{0}.ps1" -f [guid]::NewGuid().ToString('N'))
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($scriptTmp, $txt, $utf8NoBom)
    return $scriptTmp
}

# InheritConsole: do not redirect stdout/stderr. StdinPromptFilePath: prompt not in argv; written to StandardInput after Start.
function New-AgentProcessStartInfoForAgent {
    param(
        [string] $ExePath,
        [object[]] $ArgumentList,
        [switch] $InheritConsole,
        [string] $StdinPromptFilePath = $null,
        [string] $WorkingDirectoryOverride = $null
    )
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.UseShellExecute = $false
    if ($null -ne $StdinPromptFilePath -and $StdinPromptFilePath.Length -gt 0) {
        $psi.RedirectStandardInput = $true
    }
    if ($InheritConsole) {
        $psi.RedirectStandardOutput = $false
        $psi.RedirectStandardError = $false
        $psi.CreateNoWindow = $false
    }
    else {
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true
        $psi.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
        $psi.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)
    }
    if ($null -ne $WorkingDirectoryOverride -and $WorkingDirectoryOverride.Length -gt 0 -and (Test-Path -LiteralPath $WorkingDirectoryOverride -PathType Container)) {
        $psi.WorkingDirectory = $WorkingDirectoryOverride
    }
    else {
        $psi.WorkingDirectory = $Workspace
    }
    $parts = [System.Collections.Generic.List[string]]::new()
    if ($ExePath -match '\.ps1\s*$') {
        $pwsh = Resolve-AgentQueuePwshPath
        $psi.FileName = $pwsh
        @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ExePath) | ForEach-Object { $parts.Add($_) | Out-Null }
        foreach ($a in $ArgumentList) {
            $parts.Add([string]$a) | Out-Null
        }
    }
    else {
        $psi.FileName = $ExePath
        foreach ($a in $ArgumentList) {
            $parts.Add([string]$a) | Out-Null
        }
    }
    $arr = $parts.ToArray()
    if ($psi.PSObject.Properties.Name -contains 'ArgumentList') {
        foreach ($x in $arr) {
            $psi.ArgumentList.Add($x) | Out-Null
        }
    }
    else {
        $psi.Arguments = Join-AgentProcessArguments -Parts $arr
    }
    return $psi
}

function Convert-AgentPipelineStreamObjectToLines {
    param([object]$Obj)
    if ($null -eq $Obj) {
        return [string[]]@()
    }
    $s = if ($Obj -is [System.Management.Automation.ErrorRecord]) {
        $Obj.ToString()
    }
    else {
        [string]$Obj
    }
    if ($null -eq $s -or $s.Length -eq 0) {
        return [string[]]@()
    }
    $parts = $s -split "`r?`n", [StringSplitOptions]::None
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($a in $parts) {
        if ($null -ne $a -and $a.Length -gt 0) {
            $out.Add($a) | Out-Null
        }
    }
    return ,$out.ToArray()
}

function Write-AgentProcessPipelineEmitLine {
    param(
        [string]$Line,
        [bool]$FormattedStreamJson,
        [bool]$HideThinking
    )
    if ($null -eq $Line -or $Line.Length -eq 0) {
        return
    }
    $script:AgentQueueLastRunHadAnyProcessLine = $true
    if ($FormattedStreamJson) {
        try {
            Write-AgentStreamJsonLine -Line $Line -HideThinking:$HideThinking
        }
        catch {
            Close-AgentThinkingBlock
            Flush-AgentAssistantBufferForContextSwitch -NoColor $script:AgentQueueNoStreamColor
            if ($script:AgentStreamDeltaNoNewline) {
                Write-Host ""
                $script:AgentStreamDeltaNoNewline = $false
            }
            Write-Host $Line
        }
    }
    else {
        Write-Host $Line
    }
}

# After Start(): write prompt to stdin if it was not passed in argv (long prompt).
function Write-AgentProcessStdinFromFileIfNeeded {
    param(
        [System.Diagnostics.Process] $Process,
        [string] $StdinPromptFilePath
    )
    if ($null -eq $StdinPromptFilePath -or $StdinPromptFilePath.Length -eq 0) {
        return
    }
    try {
        $utf8 = [System.Text.UTF8Encoding]::new($false)
        $t = [System.IO.File]::ReadAllText($StdinPromptFilePath, $utf8)
        try {
            $Process.StandardInput.Write($t)
        }
        catch [System.IO.IOException] {
            Write-Host ('[agent-queue] Writing prompt to agent stdin failed (pipe closed). The agent may have exited already (e.g. invalid CLI args). ' + $_.Exception.Message) -ForegroundColor Red
            throw
        }
    }
    finally {
        try {
            $Process.StandardInput.Close()
        }
        catch {
        }
    }
}

function Stop-AgentQueueChildProcessTree {
    param([System.Diagnostics.Process] $Process)
    if ($null -eq $Process) {
        return
    }
    $procId = 0
    try {
        $procId = $Process.Id
    }
    catch {
        return
    }
    if ($procId -lt 1) {
        return
    }
    Write-AgentQueueDebugLog ('StopChildTree pid={0} hasExited={1}' -f $procId, $Process.HasExited)
    $isWin = $false
    try {
        $isWin = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
            [System.Runtime.InteropServices.OSPlatform]::Windows)
    }
    catch {
        if ($env:OS -and $env:OS -match 'Windows') {
            $isWin = $true
        }
    }
    if ($isWin) {
        $sysRoot = $env:SystemRoot
        if ([string]::IsNullOrWhiteSpace($sysRoot)) {
            $sysRoot = 'C:\Windows'
        }
        $tk = Join-Path $sysRoot 'System32\taskkill.exe'
        if (Test-Path -LiteralPath $tk) {
            try {
                & $tk /PID $procId /T /F 2>$null | Out-Null
            }
            catch {
            }
        }
    }
    try {
        if (-not $Process.HasExited) {
            $Process.Kill()
        }
    }
    catch {
    }
}

function Test-AgentQueueMonitorStatusStaleForStallKill {
    if ($script:AgentQueueStallRestartThresholdSeconds -le 0) {
        return $false
    }
    if (-not $script:AgentQueueMonitorStatusPath) {
        return $false
    }
    $age = $null
    if ($null -ne $script:AgentQueueStallEpochUtc) {
        $age = [DateTime]::UtcNow - $script:AgentQueueStallEpochUtc
    }
    else {
        $mp = $script:AgentQueueMonitorStatusPath
        if (-not (Test-Path -LiteralPath $mp)) {
            return $false
        }
        $last = [System.IO.File]::GetLastWriteTimeUtc($mp)
        $age = (Get-Date).ToUniversalTime() - $last
    }
    $cutoff = [double]$script:AgentQueueStallRestartThresholdSeconds
    $result = $age.TotalSeconds -gt $cutoff
    if ($result -and $script:AgentQueueDebugLogPath) {
        $now = [datetime]::UtcNow
        $logThis = $true
        if ($null -ne $script:AgentQueueDebugLastStaleTrueUtc) {
            if (($now - $script:AgentQueueDebugLastStaleTrueUtc).TotalSeconds -lt 2.0) {
                $logThis = $false
            }
        }
        if ($logThis) {
            $script:AgentQueueDebugLastStaleTrueUtc = $now
            $epochNote = if ($null -ne $script:AgentQueueStallEpochUtc) { $script:AgentQueueStallEpochUtc.ToString('o') } else { 'file-mtime' }
            Write-AgentQueueDebugLog ('STALE_TRUE ageSec={0:N2} cutoff={1} epochOrNote={2}' -f $age.TotalSeconds, $cutoff, $epochNote)
        }
    }
    return $result
}

function Invoke-AgentQueueTryConsumeManualStallRetryFlag {
    $p = $script:AgentQueueManualStallRetryFlagPath
    if (-not $p -or -not (Test-Path -LiteralPath $p)) {
        return $false
    }
    try {
        Remove-Item -LiteralPath $p -Force -ErrorAction Stop
    }
    catch {
        return $false
    }
    Write-AgentQueueDebugLog ('CONSUME_FLAG path={0} -> kill subtree next' -f $p)
    Write-Host '[agent-queue] Manual step restart requested (flag file); killing agent subprocess.' -ForegroundColor DarkCyan
    $script:AgentQueueLastRunManualRestart = $true
    return $true
}

function Write-AgentQueueManualStallRetryFlagIfAbsent {
    $p = $script:AgentQueueManualStallRetryFlagPath
    if (-not $p) {
        Write-AgentQueueDebugLog 'FlagIfAbsent SKIP (flag path empty)'
        return $false
    }
    if (Test-Path -LiteralPath $p) {
        return $false
    }
    try {
        $line = ([datetime]::UtcNow.ToString('o')) + [Environment]::NewLine
        [System.IO.File]::WriteAllText($p, $line)
        Write-AgentQueueDebugLog ('FlagIfAbsent WROTE path={0}' -f $p)
        return $true
    }
    catch {
        Write-AgentQueueDebugLog ('FlagIfAbsent WRITE_FAIL path={0} err={1}' -f $p, $_)
        return $false
    }
}

function Invoke-AgentQueueReadLineAsyncWithStall {
    param(
        [System.IO.StreamReader] $Reader,
        [System.Diagnostics.Process] $Process
    )
    $task = $Reader.ReadLineAsync()
    while (-not $task.IsCompleted) {
        if (Invoke-AgentQueueTryConsumeManualStallRetryFlag) {
            Stop-AgentQueueChildProcessTree -Process $Process
            $script:AgentQueueLastRunEndedByStallWatchdog = $true
            return $null
        }
        if ($script:AgentQueueStallRestartThresholdSeconds -gt 0 -and (Test-AgentQueueMonitorStatusStaleForStallKill)) {
            $null = Write-AgentQueueManualStallRetryFlagIfAbsent
        }
        if ($task.Wait(500)) {
            break
        }
    }
    if ($script:AgentQueueLastRunEndedByStallWatchdog) {
        return $null
    }
    if ($task.IsFaulted) {
        throw $task.Exception.GetBaseException()
    }
    return $task.Result
}

function Invoke-AgentQueuePipeProcessWithStallMonitor {
    param(
        [string] $pipeExeForPsi,
        [object[]] $pipeArgsForPsi,
        [string] $pipeStdinForWrite,
        [bool] $FormattedStreamJson,
        [bool] $HideThinking,
        [string] $WorkingDirectoryOverride = $null
    )
    $psi = New-AgentProcessStartInfoForAgent -ExePath $pipeExeForPsi -ArgumentList $pipeArgsForPsi -InheritConsole:$false -StdinPromptFilePath $pipeStdinForWrite -WorkingDirectoryOverride $WorkingDirectoryOverride
    $p = [System.Diagnostics.Process]::new()
    $p.EnableRaisingEvents = $true
    $p.StartInfo = $psi
    $script:AgentQueueLastRunHadAnyProcessLine = $false
    $script:AgentQueueLastRunEndedByStallWatchdog = $false
    $script:AgentQueueLastRunManualRestart = $false
    $exit = 1
    try {
        $null = $p.Start()
    }
    catch {
        Write-Host ('[agent-queue] Failed to start agent: {0}' -f $_) -ForegroundColor Red
        $p.Dispose()
        return 1
    }
    Write-AgentProcessStdinFromFileIfNeeded -Process $p -StdinPromptFilePath $pipeStdinForWrite
    try {
        while ($true) {
            $line = Invoke-AgentQueueReadLineAsyncWithStall -Reader $p.StandardOutput -Process $p
            if ($script:AgentQueueLastRunEndedByStallWatchdog) {
                break
            }
            if ($null -ne $line) {
                foreach ($ln in (Convert-AgentPipelineStreamObjectToLines -Obj $line)) {
                    Write-AgentProcessPipelineEmitLine -Line $ln -FormattedStreamJson:$FormattedStreamJson -HideThinking:$HideThinking
                }
                continue
            }
            if ($p.HasExited) {
                break
            }
            $lineErr = Invoke-AgentQueueReadLineAsyncWithStall -Reader $p.StandardError -Process $p
            if ($script:AgentQueueLastRunEndedByStallWatchdog) {
                break
            }
            if ($null -ne $lineErr) {
                foreach ($ln in (Convert-AgentPipelineStreamObjectToLines -Obj $lineErr)) {
                    Write-AgentProcessPipelineEmitLine -Line $ln -FormattedStreamJson:$FormattedStreamJson -HideThinking:$HideThinking
                }
                continue
            }
            if ($p.HasExited) {
                break
            }
            Start-Sleep -Milliseconds 50
        }
        if ($script:AgentQueueLastRunEndedByStallWatchdog) {
            if (-not $p.HasExited) {
                Stop-AgentQueueChildProcessTree -Process $p
                try {
                    [void]$p.WaitForExit(30000)
                }
                catch {
                }
            }
            $stderrRemain = ""
        }
        else {
            if (-not $p.HasExited) {
                [void]$p.WaitForExit(120000)
            }
            $stderrRemain = ""
            try {
                $stderrRemain = $p.StandardError.ReadToEnd()
            }
            catch {
            }
            if ($stderrRemain.Length -gt 0) {
                foreach ($chunk in ($stderrRemain -split "`r?`n")) {
                    foreach ($ln in (Convert-AgentPipelineStreamObjectToLines -Obj $chunk)) {
                        Write-AgentProcessPipelineEmitLine -Line $ln -FormattedStreamJson:$FormattedStreamJson -HideThinking:$HideThinking
                    }
                }
            }
        }
        if ($script:AgentQueueLastRunEndedByStallWatchdog) {
            $exit = 1
        }
        elseif ($p.HasExited) {
            $exit = $p.ExitCode
        }
        else {
            $exit = 1
        }
    }
    catch {
        Write-Host ('[agent-queue] Unhandled error in agent subprocess: ' + $_.Exception.Message) -ForegroundColor Red
        Write-Host ($_.ScriptStackTrace) -ForegroundColor DarkRed
        try {
            if (-not $p.HasExited) {
                Stop-AgentQueueChildProcessTree -Process $p
            }
        }
        catch {
        }
        $exit = 1
    }
    finally {
        if ($null -ne $p) {
            if (-not $p.HasExited) {
                Stop-AgentQueueChildProcessTree -Process $p
            }
            if ($p.HasExited -and -not $script:AgentQueueLastRunEndedByStallWatchdog) {
                $exit = $p.ExitCode
            }
            $p.Dispose()
        }
    }
    $global:LASTEXITCODE = $exit
    return $exit
}

# Launch agent: inherit-console branch for stream-json on Windows, else PowerShell pipeline + NDJSON parsing; StdinPromptFilePath uses stdin after argv trim.
function Invoke-AgentProcessWithPipedStdout {
    param(
        [string] $ExePath,
        [object[]] $ArgumentList,
        [bool] $FormattedStreamJson,
        [bool] $HideThinking,
        [string] $StdinPromptFilePath = $null
    )
    if ($script:AgentQueueStreamJsonInheritConsoleEffective) {
        $psiInherit = New-AgentProcessStartInfoForAgent -ExePath $ExePath -ArgumentList $ArgumentList -InheritConsole -StdinPromptFilePath $StdinPromptFilePath
        $pInherit = [System.Diagnostics.Process]::new()
        $pInherit.EnableRaisingEvents = $true
        $pInherit.StartInfo = $psiInherit
        $script:AgentQueueLastRunHadAnyProcessLine = $false
        $script:AgentQueueLastRunInheritConsoleMode = $true
        try {
            $null = $pInherit.Start()
        }
        catch {
            Write-Host ('[agent-queue] Failed to start agent: {0}' -f $_) -ForegroundColor Red
            $global:LASTEXITCODE = 1
            return 1
        }
        Write-AgentProcessStdinFromFileIfNeeded -Process $pInherit -StdinPromptFilePath $StdinPromptFilePath
        $script:AgentQueueLastRunEndedByStallWatchdog = $false
        if ($script:AgentQueueStallRestartThresholdSeconds -gt 0 -or $StallAllowManualRetry) {
            while (-not $pInherit.HasExited) {
                if (Invoke-AgentQueueTryConsumeManualStallRetryFlag) {
                    Stop-AgentQueueChildProcessTree -Process $pInherit
                    $script:AgentQueueLastRunEndedByStallWatchdog = $true
                    break
                }
                if ($script:AgentQueueStallRestartThresholdSeconds -gt 0 -and (Test-AgentQueueMonitorStatusStaleForStallKill)) {
                    $null = Write-AgentQueueManualStallRetryFlagIfAbsent
                }
                $null = $pInherit.WaitForExit(1000)
            }
        }
        else {
            $null = $pInherit.WaitForExit()
        }
        $exitInherit = 1
        if ($pInherit.HasExited) {
            $exitInherit = $pInherit.ExitCode
        }
        $pInherit.Dispose()
        $global:LASTEXITCODE = $exitInherit
        return $exitInherit
    }
    $script:AgentQueueLastRunInheritConsoleMode = $false
    $pipeRunnerScript = $null
    $pipeExeForPsi = $ExePath
    $pipeArgsForPsi = $ArgumentList
    $pipeStdinForWrite = $StdinPromptFilePath
    $nodeInvForStdin = $null
    $workingDirectoryOverride = $null
    if ($null -ne $StdinPromptFilePath -and $StdinPromptFilePath.Length -gt 0) {
        $nodeInvForStdin = Resolve-AgentQueueCursorAgentNodeExeAndIndexJs -AgentExePath $ExePath
        if ($null -ne $nodeInvForStdin) {
            $pipeExeForPsi = $nodeInvForStdin.NodeExe
            $argList = New-Object System.Collections.Generic.List[string]
            $argList.Add($nodeInvForStdin.IndexJs) | Out-Null
            foreach ($a in $ArgumentList) {
                $argList.Add([string]$a) | Out-Null
            }
            $pipeArgsForPsi = $argList.ToArray()
            $pipeStdinForWrite = $StdinPromptFilePath
            $pipeRunnerScript = $null
            $workingDirectoryOverride = $null
        }
        else {
            $pipeRunnerScript = New-AgentPipeRunnerScriptFile -PromptFilePath $StdinPromptFilePath -AgentExePath $ExePath -AgentArgs $ArgumentList
            $pipeExeForPsi = Resolve-AgentQueuePwshPath
            $pipeArgsForPsi = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $pipeRunnerScript)
            $pipeStdinForWrite = $null
            $workingDirectoryOverride = $null
        }
    }
    else {
        $nodeInvForStdin = Resolve-AgentQueueCursorAgentNodeExeAndIndexJs -AgentExePath $ExePath
        if ($null -ne $nodeInvForStdin) {
            $pipeExeForPsi = $nodeInvForStdin.NodeExe
            $argList = New-Object System.Collections.Generic.List[string]
            $argList.Add($nodeInvForStdin.IndexJs) | Out-Null
            foreach ($a in $ArgumentList) {
                $argList.Add([string]$a) | Out-Null
            }
            $pipeArgsForPsi = $argList.ToArray()
        }
    }
    if (($script:AgentQueueStallRestartThresholdSeconds -gt 0) -or $StallAllowManualRetry) {
        try {
            $script:AgentQueueLastRunHadAnyProcessLine = $false
            $exitStall = Invoke-AgentQueuePipeProcessWithStallMonitor -pipeExeForPsi $pipeExeForPsi -pipeArgsForPsi $pipeArgsForPsi -pipeStdinForWrite $pipeStdinForWrite -FormattedStreamJson:$FormattedStreamJson -HideThinking:$HideThinking -WorkingDirectoryOverride $workingDirectoryOverride
            $global:LASTEXITCODE = $exitStall
            return $exitStall
        }
        finally {
            if ($null -ne $pipeRunnerScript -and (Test-Path -LiteralPath $pipeRunnerScript)) {
                Remove-Item -LiteralPath $pipeRunnerScript -Force -ErrorAction SilentlyContinue
            }
        }
    }
    try {
        $script:AgentQueueLastRunHadAnyProcessLine = $false
        $pwshExe = Resolve-AgentQueuePwshPath
        $prevLoc = Get-Location
        try {
            $wdTarget = $Workspace
            if ($null -ne $workingDirectoryOverride -and $workingDirectoryOverride.Length -gt 0 -and (Test-Path -LiteralPath $workingDirectoryOverride -PathType Container)) {
                $wdTarget = $workingDirectoryOverride
            }
            if (Test-Path -LiteralPath $wdTarget -PathType Container) {
                Set-Location -LiteralPath $wdTarget
            }
            if ($null -ne $pipeRunnerScript -and $pipeRunnerScript.Length -gt 0) {
                & $pwshExe -NoProfile -ExecutionPolicy Bypass -File $pipeRunnerScript 2>&1 | ForEach-Object {
                    foreach ($ln in (Convert-AgentPipelineStreamObjectToLines -Obj $_)) {
                        Write-AgentProcessPipelineEmitLine -Line $ln -FormattedStreamJson:$FormattedStreamJson -HideThinking:$HideThinking
                    }
                }
            }
            elseif ($null -ne $pipeStdinForWrite -and $pipeStdinForWrite.Length -gt 0 -and $null -ne $nodeInvForStdin) {
                Get-Content -LiteralPath $pipeStdinForWrite -Raw -Encoding utf8 | & $pipeExeForPsi @pipeArgsForPsi 2>&1 | ForEach-Object {
                    foreach ($ln in (Convert-AgentPipelineStreamObjectToLines -Obj $_)) {
                        Write-AgentProcessPipelineEmitLine -Line $ln -FormattedStreamJson:$FormattedStreamJson -HideThinking:$HideThinking
                    }
                }
            }
            else {
                & $pipeExeForPsi @pipeArgsForPsi 2>&1 | ForEach-Object {
                    foreach ($ln in (Convert-AgentPipelineStreamObjectToLines -Obj $_)) {
                        Write-AgentProcessPipelineEmitLine -Line $ln -FormattedStreamJson:$FormattedStreamJson -HideThinking:$HideThinking
                    }
                }
            }
        }
        finally {
            Set-Location -LiteralPath $prevLoc.Path
        }
        $exitCode = Get-AgentLastExitCode
        $global:LASTEXITCODE = $exitCode
        return $exitCode
    }
    catch {
        Write-Host ('[agent-queue] Unhandled error in agent subprocess: ' + $_.Exception.Message) -ForegroundColor Red
        Write-Host ($_.ScriptStackTrace) -ForegroundColor DarkRed
        $global:LASTEXITCODE = 1
        return 1
    }
    finally {
        if ($null -ne $pipeRunnerScript -and (Test-Path -LiteralPath $pipeRunnerScript)) {
            Remove-Item -LiteralPath $pipeRunnerScript -Force -ErrorAction SilentlyContinue
        }
    }
}

function Write-AgentQueueConsoleFlush {
    [Console]::Out.Flush()
}

function Write-AgentQueuePreRunHints {
    param([string]$ExpandedPrompt)
    if ($OutputFormat -eq 'stream-json' -and $script:AgentQueueStreamJsonInheritConsoleEffective) {
        Write-Host '[agent-queue] stream-json: inherited console - agent prints to this window; no NDJSON formatting in agent-queue.' -ForegroundColor DarkGray
        Write-AgentQueueConsoleFlush
        return
    }
    if ($OutputFormat -ne 'stream-json' -or $RawStreamJson) {
        return
    }
    Write-Host '[agent-queue] stream-json (formatted): no console output until the first NDJSON line (can be minutes).' -ForegroundColor DarkGray
    if ($ExpandedPrompt -match '(?m)^## Superpower: (brainstorming|requesting-code-review|writing-plans|executing-plans) \(injected\)') {
        Write-Host '[agent-queue] Superpower: extra delay before first line is common (injected skill / subagent).' -ForegroundColor DarkGray
    }
    Write-AgentQueueConsoleFlush
}

function Write-AgentQueueAgentStartingBanner {
    $fmt = [string]$OutputFormat
    $tail = ""
    if ($fmt -eq "stream-json") {
        if ($script:AgentQueueStreamJsonInheritConsoleEffective) {
            $tail = ' (inherited console - NDJSON in this window)'
        }
        elseif ($RawStreamJson) {
            $tail = " (raw NDJSON)"
        }
        else {
            $tail = ' - no console output until the first NDJSON line (can be minutes; not necessarily stuck)'
        }
    }
    Write-Host ('[agent-queue] ' + (Get-Date -Format 'HH:mm:ss') + ' Starting agent (' + $fmt + ')' + $tail) -ForegroundColor DarkYellow
    Write-AgentQueueConsoleFlush
}

# One step: Build-AgentArgs, optional temp file + stdin, Invoke-AgentProcess, remove temp in finally.
function Invoke-AgentQueueInvokeAgentProcessWithStdin {
    param(
        [string] $ExePath,
        [bool] $Continue,
        [string] $ExpandedPrompt
    )
    $args = Build-AgentArgs -Continue $Continue -Prompt $ExpandedPrompt
    $r = Invoke-AgentQueueMaybeUseStdinPrompt -ExePath $ExePath -ArgumentList $args -Prompt $ExpandedPrompt -Continue $Continue
    $args = $r.Args
    $stdinPath = $r.StdinPath
    $promptTmp = $r.PromptTempFilePath
    try {
        if ($null -ne $promptTmp) {
            $nodeInv = Resolve-AgentQueueCursorAgentNodeExeAndIndexJs -AgentExePath $ExePath
            if ($null -ne $nodeInv) {
                Write-Host '[agent-queue] Long prompt: UTF-8 temp file; subprocess uses node.exe + index.js with stdin (argv under Windows limit; avoids PowerShell pipe).' -ForegroundColor DarkCyan
            }
            else {
                Write-Host '[agent-queue] Long prompt: UTF-8 temp file; subprocess uses PowerShell pipe (Get-Content | agent.ps1) so argv stays under the Windows limit.' -ForegroundColor DarkCyan
            }
            Write-AgentQueueConsoleFlush
        }
        return (Invoke-AgentProcess -ExePath $ExePath -ArgumentList $args -StdinPromptFilePath $stdinPath)
    }
    finally {
        if ($null -ne $promptTmp -and (Test-Path -LiteralPath $promptTmp)) {
            Remove-Item -LiteralPath $promptTmp -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-AgentQueueRunStep {
    param(
        [string] $ExePath,
        [bool] $Continue,
        [string] $ExpandedPrompt
    )
    $stallRetry = 0
    $code = 0
    while ($true) {
        $code = Invoke-AgentQueueInvokeAgentProcessWithStdin -ExePath $ExePath -Continue $Continue -ExpandedPrompt $ExpandedPrompt
        if ($script:AgentQueueLastRunEndedByStallWatchdog) {
            $stallRetry++
            Write-AgentQueueDebugLog ('RunStep STALL_RETRY_ATTEMPT n={0} exitCode={1} manualRestart={2}' -f $stallRetry, $code, $script:AgentQueueLastRunManualRestart)
            if ($stallRetry -ge 100) {
                Write-Host '[agent-queue] Stall watchdog: same-step restart limit (100) reached; giving up this step.' -ForegroundColor Red
                $script:AgentQueueLastRunEndedByStallWatchdog = $false
                $script:AgentQueueLastRunManualRestart = $false
                break
            }
            if ($script:AgentQueueLastRunManualRestart) {
                Write-Host ('[agent-queue] Manual step restart: restarting same step now ({0}/100).' -f $stallRetry) -ForegroundColor DarkYellow
            }
            elseif ($script:AgentQueueStallRestartThresholdSeconds -gt 0) {
                $sc = $script:AgentQueueStallRestartThresholdSeconds
                Write-Host ('[agent-queue] Stall timer exceeded ({0}s); restarting same step ({1}/100).' -f $sc, $stallRetry) -ForegroundColor DarkYellow
            }
            else {
                Write-Host ('[agent-queue] Step interrupted by stall watchdog; restarting same step ({0}/100).' -f $stallRetry) -ForegroundColor DarkYellow
            }
            $wasManualRestart = $script:AgentQueueLastRunManualRestart
            Write-AgentQueueMonitorStatusFileSameStepRestart -AttemptNumber $stallRetry -Manual $wasManualRestart
            $script:AgentQueueLastRunEndedByStallWatchdog = $false
            $script:AgentQueueLastRunManualRestart = $false
            continue
        }
        break
    }
    if (-not $script:AgentQueueLastRunHadAnyProcessLine) {
        Write-Host ('[agent-queue] Agent subprocess finished with exit code ' + $code + ' (no stdout/stderr lines captured yet for this step).') -ForegroundColor Yellow
    }
    if ($code -ne 0 -and -not $script:AgentQueueLastRunHadAnyProcessLine) {
        Write-AgentQueueFailureDebugInfo -ExePath $ExePath -Continue $Continue -ExpandedPrompt $ExpandedPrompt -ExitCode $code
    }
    elseif ($code -eq 0 -and -not $script:AgentQueueLastRunHadAnyProcessLine) {
        Write-Host '[agent-queue] Agent exited 0 with no stdout/stderr lines (empty NDJSON). If the step did nothing, run: agent status. Long prompts use stdin after --print-only argv; ensure Cursor CLI is current.' -ForegroundColor DarkYellow
    }
    Write-AgentQueueConsoleFlush
    return $code
}

# cursor-agent: plain output (text/json/raw NDJSON) always via Invoke-AgentProcessWithPipedStdout so stdout/stderr lines are tracked; formatted stream-json uses the same helper with FormattedStreamJson.
function Invoke-AgentProcess {
    param(
        [string] $ExePath,
        [object[]] $ArgumentList,
        [string] $StdinPromptFilePath = $null
    )
    Write-AgentQueueAgentStartingBanner
    $usePlainOutput = ($OutputFormat -ne "stream-json" -or $RawStreamJson)
    if ($usePlainOutput) {
        $code = Invoke-AgentProcessWithPipedStdout -ExePath $ExePath -ArgumentList $ArgumentList -FormattedStreamJson:$false -HideThinking:$false -StdinPromptFilePath $StdinPromptFilePath
        return $code
    }
    $script:AgentQueueNoStreamColor = $NoStreamColor
    $script:AgentQueueNoAssistantStreamDelta = -not $script:AgentQueueAssistantStreamDeltaEffective
    $script:AgentStreamBufferChars = $StreamBufferChars
    $script:AgentStreamBufferIdleMs = $StreamBufferIdleMs
    $script:AgentThinkingLineOpen = $false
    $script:AgentStreamDeltaNoNewline = $false
    $script:AgentAssistantTextBuffer = ""
    $script:AgentAssistantLastDeltaUtc = $null
    $script:AgentAssistantHadDeltaOutput = $false
    $script:AgentStreamJsonToolStartedCount = 0
    $code = Invoke-AgentProcessWithPipedStdout -ExePath $ExePath -ArgumentList $ArgumentList -FormattedStreamJson:$true -HideThinking:$script:AgentQueueHideThinkingEffective -StdinPromptFilePath $StdinPromptFilePath
    Close-AgentThinkingBlock
    if ($script:AgentAssistantTextBuffer.Length -gt 0) {
        Flush-AgentAssistantBufferForContextSwitch -NoColor $script:AgentQueueNoStreamColor
    }
    elseif ($script:AgentStreamDeltaNoNewline) {
        Write-Host ""
        $script:AgentStreamDeltaNoNewline = $false
    }
    return $code
}

if ($AgentQueueSmokeTest) {
    $fakeExe = Join-Path $env:TEMP ("agent-queue-smoke-agent-{0}.ps1" -f [guid]::NewGuid().ToString('N'))
    $utf8Smoke = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($fakeExe, "# smoke dummy`r`nexit 0`r`n", $utf8Smoke)
    $smokePromptPath = $null
    try {
        $longPrompt = "x" * 9000
        $ba = Build-AgentArgs -Continue $false -Prompt $longPrompt
        $est = Get-AgentQueueEstimatedCommandLineLength -ExePath $fakeExe -ArgumentList $ba
        if ($est -le $script:AgentQueueMaxCmdLineChars) {
            Write-Error ("agent-queue smoke: expected argv over limit (est={0}, max={1})" -f $est, $script:AgentQueueMaxCmdLineChars)
            exit 1
        }
        $r = Invoke-AgentQueueMaybeUseStdinPrompt -ExePath $fakeExe -ArgumentList $ba -Prompt $longPrompt -Continue $false
        if ($null -eq $r.StdinPath -or $r.StdinPath -ne $r.PromptTempFilePath) {
            Write-Error "agent-queue smoke: StdinPath and PromptTempFilePath must match for long prompt."
            exit 1
        }
        $smokePromptPath = $r.StdinPath
        if (-not (Test-Path -LiteralPath $smokePromptPath)) {
            Write-Error "agent-queue smoke: temp prompt file missing."
            exit 1
        }
        $argArr = $r.Args
        if ($argArr.Length -lt 2) {
            Write-Error "agent-queue smoke: expected argv from Build-AgentArgsForStdin."
            exit 1
        }
        $escQ = Escape-AgentPipeScriptSingleQuoted -Text "a'b"
        if ($escQ -ne "a''b") {
            Write-Error "agent-queue smoke: Escape-AgentPipeScriptSingleQuoted broken."
            exit 1
        }
        $pip = New-AgentPipeRunnerScriptFile -PromptFilePath $smokePromptPath -AgentExePath $fakeExe -AgentArgs $argArr
        try {
            $body = [System.IO.File]::ReadAllText($pip, $utf8Smoke)
        }
        finally {
            if (Test-Path -LiteralPath $pip) {
                Remove-Item -LiteralPath $pip -Force -ErrorAction SilentlyContinue
            }
        }
        if (-not $body.Contains('Get-Content -LiteralPath $PromptFilePath')) {
            Write-Error "agent-queue smoke: pipe helper must contain Get-Content -LiteralPath `$PromptFilePath."
            exit 1
        }
        if (-not $body.Contains('-Encoding utf8')) {
            Write-Error "agent-queue smoke: pipe helper must read UTF-8."
            exit 1
        }
        if (-not $body.Contains('exit $LASTEXITCODE')) {
            Write-Error "agent-queue smoke: pipe helper must propagate exit code."
            exit 1
        }
        if (-not $body.Contains('*.ps1')) {
            Write-Error "agent-queue smoke: pipe helper must branch on ps1 launcher."
            exit 1
        }
        Write-Host '[agent-queue] Smoke OK: long-prompt path, pipe-helper script, escape.' -ForegroundColor Green
        exit 0
    }
    finally {
        if (Test-Path -LiteralPath $fakeExe) {
            Remove-Item -LiteralPath $fakeExe -Force -ErrorAction SilentlyContinue
        }
        if ($null -ne $smokePromptPath -and (Test-Path -LiteralPath $smokePromptPath)) {
            Remove-Item -LiteralPath $smokePromptPath -Force -ErrorAction SilentlyContinue
        }
    }
}

if ($usePipelineOrder) {
    $pnCount = $promptLines.Count
    $flatOrder = New-Object System.Collections.Generic.List[int]
    for ($gc = 1; $gc -le $Cycles; $gc++) {
        $orderForFlat = Get-PipelineOrderForGlobalCycle -Cycles $Cycles -CyclesPerChat $CyclesPerChat -GlobalCycle $gc -N $pnCount
        foreach ($x in $orderForFlat) {
            $flatOrder.Add($x) | Out-Null
        }
    }
    $targetBlock0 = $StartFromPrompt - 1
    $startOffset = 0
    $skipUntilStart = $false
    if ($StartFromPrompt -gt 1) {
        $skipUntilStart = $true
        $foundStart = $false
        for ($fi = 0; $fi -lt $flatOrder.Count; $fi++) {
            if ($flatOrder[$fi] -eq $targetBlock0) {
                $startOffset = $fi
                $foundStart = $true
                break
            }
        }
        if (-not $foundStart) {
            Write-Error "StartFromPrompt $StartFromPrompt : no pipeline step uses that block; zero-based index = $targetBlock0 in this run."
        }
        Write-Host ('agent-queue: starting at prompt block #' + $StartFromPrompt + ' (skipping ' + $startOffset + ' earlier pipeline steps).') -ForegroundColor DarkCyan
    }
    $totalSteps = $flatOrder.Count - $startOffset
    $globalStep = 0
    for ($c = 1; $c -le $Cycles; $c++) {
        $order = Get-PipelineOrderForGlobalCycle -Cycles $Cycles -CyclesPerChat $CyclesPerChat -GlobalCycle $c -N $pnCount
        if ($CyclesPerChat -le 0) {
            $cycleInSession = $c
        }
        else {
            $cycleInSession = (($c - 1) % $CyclesPerChat) + 1
        }
        $useFirstInSession = ($cycleInSession -eq 1)
        $sessNote = if ($CyclesPerChat -gt 0) { " session $cycleInSession/$CyclesPerChat" } else { "" }
        Write-Host ('=== agent-queue: cycle ' + $c + ' / ' + $Cycles + $sessNote + ' (' + $order.Length + ' steps) ===') -ForegroundColor Cyan
        $stepInCycle = 0
        $isContinue = -not $useFirstInSession
        $orderArr = @($order)
        for ($oi = 0; $oi -lt $orderArr.Length; $oi++) {
            $idx = $orderArr[$oi]
            if ($skipUntilStart) {
                if ($idx -ne $targetBlock0) {
                    continue
                }
                $skipUntilStart = $false
            }
            $globalStep++
            $stepInCycle++
            Write-Host ('[agent-queue] ' + (Get-Date -Format 'HH:mm:ss') + " Step $globalStep / $totalSteps - prompt block $($idx + 1) ...") -ForegroundColor DarkGray
            Write-AgentQueueConsoleFlush
            $p = $promptLines[$idx]
            $pExp = Expand-AgentPromptSuperpowers -Prompt $p
            $effectiveContinue = $isContinue
            if ($ContinueFirstPrompt -and $globalStep -eq 1) {
                $effectiveContinue = $true
            }
            $args = Build-AgentArgs -Continue $effectiveContinue -Prompt $pExp
            $label = if ($effectiveContinue) { "continue" } else { "new" }
            $preview = Get-AgentQueuePromptPreviewLine -Text $p
            $pn = $idx + 1
            $spTag = if ($p -ceq $pExp) { "" } else { " [superpower]" }
            $hdr = ('[{0}/{1}] c{2} s{3}/{4} #{5} ({6}){7} ' -f $globalStep, $totalSteps, $c, $stepInCycle, $order.Length, $pn, $label, $spTag)
            if (-not $NoStreamColor) {
                Write-Host $hdr -NoNewline -ForegroundColor DarkGray
                Write-Host $preview -ForegroundColor Yellow
            }
            else {
                Write-Host "$hdr$preview" -ForegroundColor DarkGray
            }
            Write-AgentQueueConsoleFlush
            $nextPn = $null
            $nextPv = ""
            if ($oi + 1 -lt $orderArr.Length) {
                $nIdx = $orderArr[$oi + 1]
                $nextPn = $nIdx + 1
                $nextPv = Get-AgentQueuePromptPreviewLine -Text $promptLines[$nIdx]
            }
            $nextBit = if ($null -ne $nextPn) { '#' + $nextPn + ' -> ' + $nextPv } else { '(none)' }
            $sum = "cycle $c / $Cycles | global step $globalStep / $totalSteps | block $pn | next: $nextBit"
            $injectedSp = Get-AgentQueueInjectedSuperpowerName -OriginalPrompt $p -ExpandedPrompt $pExp
            Write-AgentQueueMonitorStatusFile @{
                phase = 'starting_agent'
                mode = 'pipeline'
                cycle = $c
                cyclesTotal = $Cycles
                globalStep = $globalStep
                totalStepsGlobal = $totalSteps
                stepInCycle = $stepInCycle
                stepsInCycle = $order.Length
                promptBlockIndex = $pn
                currentPreview = $preview
                nextPromptBlockIndex = $nextPn
                nextPreview = $nextPv
                summaryLine = $sum
                superpower = $injectedSp
            }
            if ($DryRun) {
                $exeLabel = if ($AgentPath) { $AgentPath } else { $AgentExe }
                Write-Host ("Would run: {0} {1}" -f $exeLabel, ($args -join ' '))
                $estLine = Get-AgentQueueEstimatedCommandLineLength -ExePath $AgentPath -ArgumentList $args
                if ($estLine -gt $script:AgentQueueMaxCmdLineChars) {
                    Write-Host '  (DryRun: actual run would use temp file + pwsh pipe runner; argv would exceed Windows command-line limit.)' -ForegroundColor DarkGray
                }
            }
            else {
                Write-AgentQueuePreRunHints -ExpandedPrompt $pExp
                $code = Invoke-AgentQueueRunStep -ExePath $AgentPath -Continue $effectiveContinue -ExpandedPrompt $pExp
                if ($code -ne 0) {
                    $ec = [int]$code
                    Write-Host "agent-queue: Cursor Agent exited with code $ec (no further steps). Fix auth first: agent login, agent status; then model/subscription if needed." -ForegroundColor Red
                    Write-AgentQueueStepFailureDiagnostics -ExitCode $ec
                    Write-AgentQueueConsoleFlush
                    try {
                        [Console]::Error.Flush()
                    }
                    catch {
                    }
                    $global:LASTEXITCODE = $ec
                    exit $ec
                }
            }
            $isContinue = $true
            if ($DelaySeconds -gt 0) {
                Start-Sleep -Seconds $DelaySeconds
            }
        }
        if (Test-Path -LiteralPath $script:AgentQueueFinishAfterCycleFlagPath) {
            Write-Host ('agent-queue: finish-after-cycle flag detected - exiting before cycle ' + ($c + 1) + ' of ' + $Cycles + '.') -ForegroundColor DarkYellow
            Remove-Item -LiteralPath $script:AgentQueueFinishAfterCycleFlagPath -Force -ErrorAction SilentlyContinue
            break
        }
    }
}
else {
    $isContinue = $false
    $round = 0
    $pc = $promptLines.Count
    $roundsTotalForMonitor = $null
    if (-not $Loop) {
        $roundsTotalForMonitor = 1
    }
    elseif ($MaxRounds -gt 0) {
        $roundsTotalForMonitor = $MaxRounds
    }
    while ($true) {
        $round++
        if ($MaxRounds -gt 0 -and $round -gt $MaxRounds) {
            break
        }
        Write-Host "=== agent-queue: round $round ===" -ForegroundColor Cyan
        if ($Loop) {
            if ($round -eq 1) {
                $from0 = 0
                if ($StartFromPrompt -gt 1) {
                    $from0 = $StartFromPrompt - 1
                    Write-Host ('agent-queue: round 1 from block #' + $StartFromPrompt + ' through #' + $pc + '.') -ForegroundColor DarkCyan
                }
                $range = $from0..($pc - 1)
            }
            else {
                if ($pc -le 1) {
                    $range = @(0)
                    Write-Host "agent-queue: loop round $round - single prompt block only." -ForegroundColor DarkCyan
                }
                else {
                    $range = 1..($pc - 1)
                    Write-Host ('agent-queue: loop round ' + $round + ' - blocks #2..#' + $pc + ' (block #1 runs only in round 1).') -ForegroundColor DarkCyan
                }
            }
        }
        else {
            $from0 = 0
            if ($StartFromPrompt -gt 1) {
                $from0 = $StartFromPrompt - 1
                Write-Host ('agent-queue: starting at block #' + $StartFromPrompt + ' (skipping earlier blocks).') -ForegroundColor DarkCyan
            }
            $range = $from0..($pc - 1)
        }
        $stepInRound = 0
        $rangeArr = @($range)
        $roundLen = $rangeArr.Length
        for ($ri = 0; $ri -lt $rangeArr.Length; $ri++) {
            $i0 = $rangeArr[$ri]
            $stepInRound++
            Write-Host ('[agent-queue] ' + (Get-Date -Format 'HH:mm:ss') + " Step $stepInRound / $roundLen - prompt block $($i0 + 1) ...") -ForegroundColor DarkGray
            Write-AgentQueueConsoleFlush
            $p = $promptLines[$i0]
            $index = $i0 + 1
            $pExp = Expand-AgentPromptSuperpowers -Prompt $p
            $effectiveContinue = $isContinue
            if ($ContinueFirstPrompt -and $round -eq 1 -and $stepInRound -eq 1) {
                $effectiveContinue = $true
            }
            $args = Build-AgentArgs -Continue $effectiveContinue -Prompt $pExp
            $label = if ($effectiveContinue) { "continue" } else { "new" }
            $preview = Get-AgentQueuePromptPreviewLine -Text $p
            $spTag = if ($p -ceq $pExp) { "" } else { " [superpower]" }
            $hdr = ('[{0}/{1}] #{2} ({3}){4} ' -f $stepInRound, $roundLen, $index, $label, $spTag)
            if (-not $NoStreamColor) {
                Write-Host $hdr -NoNewline -ForegroundColor DarkGray
                Write-Host $preview -ForegroundColor Yellow
            }
            else {
                Write-Host "$hdr$preview" -ForegroundColor DarkGray
            }
            Write-AgentQueueConsoleFlush
            $nextIdx = $null
            $nextPv = ""
            if ($ri + 1 -lt $rangeArr.Length) {
                $ni = $rangeArr[$ri + 1]
                $nextIdx = $ni + 1
                $nextPv = Get-AgentQueuePromptPreviewLine -Text $promptLines[$ni]
            }
            $seqNext = if ($null -ne $nextIdx) { '#' + $nextIdx + ' -> ' + $nextPv } else { '(none)' }
            $sumSeq = ('round ' + $round + ' | step ' + $stepInRound + ' / ' + $roundLen + ' | block #' + $index + ' | next: ' + $seqNext)
            $injectedSpSeq = Get-AgentQueueInjectedSuperpowerName -OriginalPrompt $p -ExpandedPrompt $pExp
            Write-AgentQueueMonitorStatusFile @{
                phase = 'starting_agent'
                mode = 'sequential'
                round = $round
                roundsTotal = $roundsTotalForMonitor
                stepInRound = $stepInRound
                stepsInRound = $roundLen
                promptBlockIndex = $index
                currentPreview = $preview
                nextPromptBlockIndex = $nextIdx
                nextPreview = $nextPv
                summaryLine = $sumSeq
                superpower = $injectedSpSeq
            }
            if ($DryRun) {
                $exeLabel = if ($AgentPath) { $AgentPath } else { $AgentExe }
                Write-Host ("Would run: {0} {1}" -f $exeLabel, ($args -join ' '))
                $estLine = Get-AgentQueueEstimatedCommandLineLength -ExePath $AgentPath -ArgumentList $args
                if ($estLine -gt $script:AgentQueueMaxCmdLineChars) {
                    Write-Host '  (DryRun: actual run would use temp file + pwsh pipe runner; argv would exceed Windows command-line limit.)' -ForegroundColor DarkGray
                }
            }
            else {
                Write-AgentQueuePreRunHints -ExpandedPrompt $pExp
                $code = Invoke-AgentQueueRunStep -ExePath $AgentPath -Continue $effectiveContinue -ExpandedPrompt $pExp
                if ($code -ne 0) {
                    $ec = [int]$code
                    Write-Host "agent-queue: Cursor Agent exited with code $ec (no further steps). Fix auth first: agent login, agent status; then model/subscription if needed." -ForegroundColor Red
                    Write-AgentQueueStepFailureDiagnostics -ExitCode $ec
                    Write-AgentQueueConsoleFlush
                    try {
                        [Console]::Error.Flush()
                    }
                    catch {
                    }
                    $global:LASTEXITCODE = $ec
                    exit $ec
                }
            }
            $isContinue = $true
            if ($DelaySeconds -gt 0) {
                Start-Sleep -Seconds $DelaySeconds
            }
        }
        if (Test-Path -LiteralPath $script:AgentQueueFinishAfterCycleFlagPath) {
            Write-Host ('agent-queue: finish-after-cycle flag detected - exiting before round ' + ($round + 1) + '.') -ForegroundColor DarkYellow
            Remove-Item -LiteralPath $script:AgentQueueFinishAfterCycleFlagPath -Force -ErrorAction SilentlyContinue
            break
        }
        if (-not $Loop) {
            break
        }
    }
}

Write-AgentQueueMonitorStatusFile @{
    phase = 'done'
    summaryLine = 'agent-queue: finished OK'
}
Write-Host "=== agent-queue: done ===" -ForegroundColor Green
exit 0