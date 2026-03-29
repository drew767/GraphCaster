# Copyright GraphCaster. All Rights Reserved.
# Диагностический прогон: первый блок pipeline автотестов (stream-json через конвейер PowerShell).
# После правок agent-queue.ps1 запускайте этот скрипт и убедитесь, что шаг доходит до завершения агента.
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
& (Join-Path $PSScriptRoot "agent-queue.ps1") `
    -PromptFile (Join-Path $PSScriptRoot "prompts\agent-queue.autotests.pipeline.prompts.txt") `
    -Cycles 1 `
    -CyclesPerChat 1 `
    -Workspace $repoRoot `
    -StartFromPrompt 1
