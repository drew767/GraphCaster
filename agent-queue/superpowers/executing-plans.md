<!-- Copyright GraphCaster. All Rights Reserved. Text from Superpowers executing-plans skill; adapted for graph-caster agent-queue. -->
---
name: executing-plans
description: Use when you have a written implementation plan to execute with review checkpoints
---

# Executing Plans

## Path convention

Treat every path in the plan as **relative to the workspace root** (`agent-queue.ps1 -Workspace` / Cursor workspace). Open `doc/plans/<file>.md` as `<workspace>/doc/plans/<file>.md`.

## Overview

Load the plan from `doc/plans/*.md` under the workspace root, challenge it briefly, then execute every task until done. Prefer the **latest** dated plan if several files match the current feature.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## Process

### 1. Load and review

1. Read the plan file.
2. If the plan is unusable (missing paths, logical gaps), repair the plan file first, then execute.
3. Use TodoWrite (or equivalent) to track tasks.

### 2. Execute tasks

For each task: mark in progress, follow steps in order, run listed verifications, mark completed. Do not skip verifications.

### 3. Complete

When all tasks pass:

- Run relevant automated tests for touched areas using **workspace-relative** paths from the plan, e.g. `py -3 -m pytest python/tests/...`; under `ui/` use the plan’s listed test command.
- Summarize what changed and what remains optional.
- If **finishing-a-development-branch** is available in your environment, use it before merge-style handoff; otherwise stop after tests and a concise completion report.

## Stop conditions

Stop and report if a step is ambiguous, dependencies are missing, or the same verification fails repeatedly after a reasonable fix attempt—do not guess.

## Branching

Do not start large implementations on `main` without explicit instructions—use the branch the human or plan already selected.

## Integration

- **writing-plans** — produces the document this skill runs against.
- **brainstorming** — may precede planning in the queue; carry decisions into the plan file.
