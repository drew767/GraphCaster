// Copyright GraphCaster. All Rights Reserved.

/**
 * Derives a chronological execution step list (n8n-style execution list / Dify node timeline)
 * from the same NDJSON buffer as the console. Pure function — no store side effects.
 */

import { splitStderrPrefix } from "./consoleLineMeta";
import { parseRunEventLine } from "./parseRunEventLine";

export type RunTimelineStatus =
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "cancelled"
  | "partial";

/** CSS modifier for console / execution timeline rows (status dot). */
export function runTimelineStatusRowClass(status: RunTimelineStatus): string {
  switch (status) {
    case "running":
      return "gc-run-timeline-row--running";
    case "success":
      return "gc-run-timeline-row--success";
    case "failed":
      return "gc-run-timeline-row--failed";
    case "skipped":
      return "gc-run-timeline-row--skipped";
    case "cancelled":
      return "gc-run-timeline-row--cancelled";
    case "partial":
      return "gc-run-timeline-row--partial";
    default: {
      const _x: never = status;
      return _x;
    }
  }
}

export type RunTimelineRow = {
  id: string;
  nodeId: string;
  nodeType: string | null;
  status: RunTimelineStatus;
  startedLineIndex: number;
  endedLineIndex?: number;
  /** Optional wall-clock span when events carry parseable timestamps (ms). */
  durationMs?: number;
  summary?: string;
};

type MutableRow = RunTimelineRow;

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t === "" ? null : t;
}

function parseOptionalTimeMs(o: Record<string, unknown>): number | null {
  for (const key of ["ts", "at", "timestamp", "time"]) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === "string" && v.trim() !== "") {
      const n = Date.parse(v);
      if (!Number.isNaN(n)) {
        return n;
      }
    }
  }
  return null;
}

function appendSummary(row: MutableRow, chunk: string): void {
  const c = chunk.trim();
  if (c === "") {
    return;
  }
  if (row.summary == null || row.summary === "") {
    row.summary = c.length > 120 ? `${c.slice(0, 117)}…` : c;
    return;
  }
  const next = `${row.summary} · ${c}`;
  row.summary = next.length > 200 ? `${next.slice(0, 197)}…` : next;
}

/**
 * When a new node starts before `process_complete`, infer the previous step succeeded from stream
 * ordering (n8n-style). This is not a host-confirmed `process_complete`; if the log is incomplete,
 * status may be wrong until a later `run_finished` / `run_end` adjusts the run outcome.
 */
function flushOpenSuccess(open: MutableRow | null, rows: RunTimelineRow[], endLineIndex: number): MutableRow | null {
  if (open == null || open.status !== "running") {
    return open;
  }
  open.status = "success";
  open.endedLineIndex = endLineIndex;
  rows.push(open);
  return null;
}

/** Maps broker `run_finished.status` (see runner.py) to a closed-row timeline status. */
function runFinishedTimelineStatus(o: Record<string, unknown>): Exclude<RunTimelineStatus, "running" | "skipped"> {
  const st = o.status;
  if (st === "success") {
    return "success";
  }
  if (st === "cancelled") {
    return "cancelled";
  }
  if (st === "partial") {
    return "partial";
  }
  return "failed";
}

function finalizeRow(
  open: MutableRow,
  status: Exclude<RunTimelineStatus, "running">,
  endLineIndex: number,
  rows: RunTimelineRow[],
): null {
  open.status = status;
  open.endedLineIndex = endLineIndex;
  rows.push(open);
  return null;
}

/**
 * Fold console lines into timeline rows. Uses the same line indices as `consoleLines` for navigation.
 */
export function reduceConsoleLinesToRunTimeline(lines: string[]): RunTimelineRow[] {
  const rows: RunTimelineRow[] = [];
  let open: MutableRow | null = null;
  const enterCountByNode = new Map<string, number>();
  let openStartTimeMs: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const { payload } = splitStderrPrefix(lines[i]);
    const ev = parseRunEventLine(payload);
    if (ev == null || typeof ev !== "object" || Array.isArray(ev)) {
      continue;
    }
    const o = ev as Record<string, unknown>;
    const type = nonEmptyString(o.type);
    if (type == null) {
      continue;
    }

    const tMs = parseOptionalTimeMs(o);

    if (type === "node_enter") {
      const nodeId = nonEmptyString(o.nodeId);
      if (nodeId == null) {
        continue;
      }
      const nodeType = nonEmptyString(o.nodeType);
      if (i > 0) {
        open = flushOpenSuccess(open, rows, i - 1);
      }
      const n = (enterCountByNode.get(nodeId) ?? 0) + 1;
      enterCountByNode.set(nodeId, n);
      open = {
        id: `${nodeId}-${n}`,
        nodeId,
        nodeType,
        status: "running",
        startedLineIndex: i,
      };
      openStartTimeMs = tMs;
      continue;
    }

    if (type === "node_execute") {
      const nodeId = nonEmptyString(o.nodeId);
      if (nodeId == null) {
        continue;
      }
      const nodeType = nonEmptyString(o.nodeType);
      if (open == null || open.nodeId !== nodeId) {
        if (i > 0) {
          open = flushOpenSuccess(open, rows, i - 1);
        }
        const enterOrdinal: number = (enterCountByNode.get(nodeId) ?? 0) + 1;
        enterCountByNode.set(nodeId, enterOrdinal);
        open = {
          id: `${nodeId}-${enterOrdinal}`,
          nodeId,
          nodeType,
          status: "running",
          startedLineIndex: i,
        };
        openStartTimeMs = tMs;
      }
      continue;
    }

    if (type === "process_complete") {
      const nodeId = nonEmptyString(o.nodeId);
      if (nodeId == null || open == null || open.nodeId !== nodeId) {
        continue;
      }
      const cancelled = o.cancelled === true;
      const success = o.success !== false && !cancelled;
      const status: "success" | "failed" = success ? "success" : "failed";
      if (openStartTimeMs != null && tMs != null && tMs >= openStartTimeMs) {
        open.durationMs = tMs - openStartTimeMs;
      }
      open = finalizeRow(open, status, i, rows);
      openStartTimeMs = null;
      continue;
    }

    if (type === "process_failed") {
      const nodeId = nonEmptyString(o.nodeId);
      if (nodeId == null) {
        continue;
      }
      if (open != null && open.nodeId === nodeId && open.status === "running") {
        if (openStartTimeMs != null && tMs != null && tMs >= openStartTimeMs) {
          open.durationMs = tMs - openStartTimeMs;
        }
        open = finalizeRow(open, "failed", i, rows);
        openStartTimeMs = null;
      }
      continue;
    }

    if (type === "error") {
      const nodeId = nonEmptyString(o.nodeId);
      if (nodeId != null && open != null && open.nodeId === nodeId && open.status === "running") {
        if (openStartTimeMs != null && tMs != null && tMs >= openStartTimeMs) {
          open.durationMs = tMs - openStartTimeMs;
        }
        open = finalizeRow(open, "failed", i, rows);
        openStartTimeMs = null;
      }
      continue;
    }

    if (type === "branch_skipped") {
      const fromNode = nonEmptyString(o.fromNode);
      if (fromNode == null) {
        continue;
      }
      const reason = nonEmptyString(o.reason);
      rows.push({
        id: `skip-${fromNode}-${i}`,
        nodeId: fromNode,
        nodeType: null,
        status: "skipped",
        startedLineIndex: i,
        endedLineIndex: i,
        summary: reason ?? undefined,
      });
      continue;
    }

    if (type === "agent_step") {
      const nodeId = nonEmptyString(o.nodeId);
      const phase = nonEmptyString(o.phase);
      const msg = typeof o.message === "string" ? o.message : "";
      if (open != null && nodeId != null && open.nodeId === nodeId && open.status === "running") {
        const parts = [phase && `phase:${phase}`, msg.trim()].filter(Boolean).join(" ");
        if (parts !== "") {
          appendSummary(open, parts);
        }
      }
      continue;
    }

    if (type === "process_output") {
      /* noise: does not create timeline rows */
      continue;
    }

    if (type === "run_finished") {
      if (open != null && open.status === "running") {
        if (openStartTimeMs != null && tMs != null && tMs >= openStartTimeMs) {
          open.durationMs = tMs - openStartTimeMs;
        }
        open = finalizeRow(open, runFinishedTimelineStatus(o), i, rows);
        openStartTimeMs = null;
      }
      continue;
    }

    if (type === "run_success") {
      const nodeId = nonEmptyString(o.nodeId);
      if (nodeId != null && open != null && open.nodeId === nodeId && open.status === "running") {
        if (openStartTimeMs != null && tMs != null && tMs >= openStartTimeMs) {
          open.durationMs = tMs - openStartTimeMs;
        }
        open = finalizeRow(open, "success", i, rows);
        openStartTimeMs = null;
      }
      continue;
    }

    if (type === "run_end") {
      if (open != null && open.status === "running") {
        if (openStartTimeMs != null && tMs != null && tMs >= openStartTimeMs) {
          open.durationMs = tMs - openStartTimeMs;
        }
        open = finalizeRow(open, "failed", i, rows);
        openStartTimeMs = null;
      }
      continue;
    }

    if (type === "ai_route_failed") {
      const nodeId = nonEmptyString(o.nodeId);
      if (nodeId != null && open != null && open.nodeId === nodeId && open.status === "running") {
        open = finalizeRow(open, "failed", i, rows);
        openStartTimeMs = null;
      }
      continue;
    }
  }

  if (open != null) {
    rows.push(open);
  }

  return rows;
}

/** Largest **durationMs** among rows (0 if none). */
export function maxTimelineDurationMs(rows: RunTimelineRow[]): number {
  let m = 0;
  for (const r of rows) {
    const d = r.durationMs;
    if (d != null && Number.isFinite(d) && d > m) {
      m = d;
    }
  }
  return m;
}

/**
 * Greedy lane indices for overlapping steps on the console line axis (parallel hint).
 * Open-ended rows (no **endedLineIndex**) extend through the last **startedLineIndex** in **rows**.
 */
export function assignTimelineLanes(rows: RunTimelineRow[]): number[] {
  const tail = rows.length ? rows[rows.length - 1]!.startedLineIndex + 1 : 0;
  const endFor = (r: RunTimelineRow) => r.endedLineIndex ?? tail;

  const lanes: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const a0 = r.startedLineIndex;
    const a1 = endFor(r);
    let lane = 0;
    while (true) {
      let clash = false;
      for (let j = 0; j < i; j++) {
        if (lanes[j] !== lane) {
          continue;
        }
        const o = rows[j]!;
        const b0 = o.startedLineIndex;
        const b1 = endFor(o);
        if (a0 <= b1 && b0 <= a1) {
          clash = true;
          break;
        }
      }
      if (!clash) {
        break;
      }
      lane++;
    }
    lanes.push(lane);
  }
  return lanes;
}
