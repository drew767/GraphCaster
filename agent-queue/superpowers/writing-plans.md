<!-- Copyright Aura. All Rights Reserved. Text from Superpowers writing-plans skill; adapted for graph-caster agent-queue. -->
---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## Path convention

Use paths **relative to the workspace root** (Cursor `--workspace` / `agent-queue.ps1 -Workspace`; default for this tree is the **graph-caster** repo root: parent of `agent-queue/`). Prefer forward slashes in prose. Examples: `python/tests/test_x.py`, `ui/src/run/foo.ts`, `doc/plans/YYYY-MM-DD-feature.md`, `agent-queue/prompts/agent-queue.pipeline.prompts.txt`.

## Overview

Write a detailed implementation plan for **graph-caster** (layout under that root: `python/`, `ui/`, `schemas/`, `doc/`). Assume the engineer has little prior context. Include exact **relative** file paths, test commands, and bite-sized steps. Prefer DRY, YAGNI, TDD, small commits.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Save plans to:** `doc/plans/YYYY-MM-DD-<feature-name>.md` under the workspace root (create `doc/plans` if needed).

## Scope

If the work spans unrelated areas, split into separate plan files—one cohesive feature per plan, each shippable with tests.

## File structure (before tasks)

List files to create or modify and what each owns. Follow existing patterns in this repo; do not re-layer the tree without reason.

## Task granularity

Each step is one short action: write failing test → run (fail) → minimal fix → run (pass) → commit (when the task allows commits).

## Plan header (required)

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** follow **executing-plans** (this queue) task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** …

**Architecture:** …

**Tech Stack:** …

---
```

## Task template

- Exact **workspace-relative** paths: `python/...`, `ui/src/...`, `doc/...`
- Embed concrete code snippets and exact commands with expected results
- Reference repo docs: `doc/DEVELOPMENT_PLAN.md`, `doc/IMPLEMENTED_FEATURES.md`, `doc/COMPETITIVE_ANALYSIS.md` as needed

## Review

Self-review the plan once complete (completeness, paths, test commands). In headless runs there is no separate reviewer subagent—fix gaps yourself.

## After saving

State the saved path. Continue with the next queue step (`/executing-plans`) when instructed; do not ask permission to proceed on this pipeline.
