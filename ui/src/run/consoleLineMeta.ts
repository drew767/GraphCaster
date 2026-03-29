// Copyright GraphCaster. All Rights Reserved.

import { parseRunEventLine } from "./parseRunEventLine";

export const STDERR_PREFIX = "[stderr] ";

/** Matches keywords from app.run.console.outputTruncated (en + ru) for search when UI shows i18n only. */
const STREAM_BACKPRESSURE_SEARCH_EXTRA =
  "Console process_output dropped subscriber queue SSE persisted Консоль отброшено очередь подписчика NDJSON stream_backpressure";

export type ConsoleLineMeta = {
  rawLine: string;
  displayLine: string;
  isStderr: boolean;
  parsedType: string | null;
  nodeId: string | null;
  isErrorLike: boolean;
  /** When set, ConsolePanel shows i18n warning instead of raw `displayLine`. */
  streamBackpressureDropped?: number;
};

export function splitStderrPrefix(line: string): { isStderr: boolean; payload: string } {
  if (line.startsWith(STDERR_PREFIX)) {
    return { isStderr: true, payload: line.slice(STDERR_PREFIX.length) };
  }
  return { isStderr: false, payload: line };
}

/** Matches literal substrings in the raw line (may trigger on host/debug text that is not JSON). */
function heuristicFailedStatusSubstring(rawLine: string): boolean {
  if (rawLine.includes('"status":"failed"')) {
    return true;
  }
  if (rawLine.includes('"status": "failed"')) {
    return true;
  }
  return false;
}

function isErrorLikeFromParsed(ev: unknown, isStderr: boolean, rawLine: string): boolean {
  if (isStderr) {
    return true;
  }
  if (heuristicFailedStatusSubstring(rawLine)) {
    return true;
  }
  if (!ev || typeof ev !== "object" || ev === null || Array.isArray(ev)) {
    return false;
  }
  const o = ev as Record<string, unknown>;
  const t = o.type;
  const typeStr = typeof t === "string" ? t : "";

  if (typeStr === "error" || typeStr === "process_failed" || typeStr === "agent_failed") {
    return true;
  }

  if (typeStr === "branch_taken" && o.route === "error") {
    return true;
  }

  if (typeStr === "run_finished") {
    return o.status === "failed";
  }

  if (typeStr === "run_end") {
    const reason = o.reason;
    if (reason === "no_outgoing_or_no_matching_condition") {
      return true;
    }
    return false;
  }

  if (typeStr === "process_complete") {
    if (o.success === false) {
      return true;
    }
    const reason = o.reason;
    if (typeof reason === "string" && reason === "spawn_error") {
      return true;
    }
  }

  return false;
}

export function buildConsoleLineMeta(rawLine: string): ConsoleLineMeta {
  const { isStderr: prefixedStderr, payload } = splitStderrPrefix(rawLine);
  const ev = parseRunEventLine(payload);
  let parsedType: string | null = null;
  let nodeId: string | null = null;
  if (ev && typeof ev === "object" && ev !== null && !Array.isArray(ev)) {
    const o = ev as Record<string, unknown>;
    const ty = o.type;
    if (typeof ty === "string") {
      parsedType = ty;
    }
    const nid = o.nodeId;
    if (typeof nid === "string" && nid.trim() !== "") {
      nodeId = nid.trim();
    } else if (parsedType === "branch_taken" || parsedType === "branch_skipped") {
      const from = o.fromNode;
      if (typeof from === "string" && from.trim() !== "") {
        nodeId = from.trim();
      }
    } else if (parsedType === "structure_warning") {
      const fid = o.forkNodeId;
      if (typeof fid === "string" && fid.trim() !== "") {
        nodeId = fid.trim();
      }
    }
  }

  if (parsedType === "stream_backpressure" && ev && typeof ev === "object" && ev !== null && !Array.isArray(ev)) {
    const o = ev as Record<string, unknown>;
    const n = o.droppedOutputLines;
    const count = typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0;
    const isStderr = prefixedStderr;
    return {
      rawLine,
      displayLine: rawLine,
      isStderr,
      parsedType,
      nodeId: null,
      isErrorLike: false,
      streamBackpressureDropped: count > 0 ? count : undefined,
    };
  }

  if (parsedType === "agent_step" && ev && typeof ev === "object" && ev !== null && !Array.isArray(ev)) {
    const o = ev as Record<string, unknown>;
    const nid =
      typeof o.nodeId === "string" && o.nodeId.trim() !== ""
        ? o.nodeId.trim()
        : nodeId != null
          ? nodeId
          : "?";
    const phase = typeof o.phase === "string" && o.phase.trim() !== "" ? o.phase.trim() : "";
    const message = typeof o.message === "string" ? o.message.trim() : "";
    const detail = [phase && `phase=${phase}`, message && `message=${message}`].filter(Boolean).join(" ");
    const body = detail ? `[${nid}] agent_step ${detail}` : `[${nid}] agent_step`;
    return {
      rawLine,
      displayLine: body,
      isStderr: prefixedStderr,
      parsedType,
      nodeId: nid,
      isErrorLike: isErrorLikeFromParsed(ev, prefixedStderr, rawLine),
    };
  }

  if (parsedType === "process_output" && ev && typeof ev === "object" && ev !== null && !Array.isArray(ev)) {
    const o = ev as Record<string, unknown>;
    const stream = o.stream;
    const text = typeof o.text === "string" ? o.text : "";
    const nid =
      typeof o.nodeId === "string" && o.nodeId.trim() !== ""
        ? o.nodeId.trim()
        : nodeId != null
          ? nodeId
          : "?";
    const fromSubprocStderr = stream === "stderr";
    const isStderr = prefixedStderr || fromSubprocStderr;
    const body = `[${nid}] ${text}`;
    const displayLine = fromSubprocStderr ? `${STDERR_PREFIX}${body}` : body;
    const isErrorLike = isErrorLikeFromParsed(ev, isStderr, rawLine);
    return {
      rawLine,
      displayLine,
      isStderr,
      parsedType,
      nodeId: nid,
      isErrorLike,
    };
  }

  const isStderr = prefixedStderr;
  const isErrorLike = isErrorLikeFromParsed(ev, isStderr, rawLine);
  return {
    rawLine,
    displayLine: rawLine,
    isStderr,
    parsedType,
    nodeId,
    isErrorLike,
  };
}

export type ConsoleFilterMode = "all" | "stderr" | "errors";

export function passesConsoleFilter(meta: ConsoleLineMeta, mode: ConsoleFilterMode): boolean {
  switch (mode) {
    case "all":
      return true;
    case "stderr":
      return meta.isStderr;
    case "errors":
      return meta.isErrorLike;
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function consoleLineMatchesSearch(meta: ConsoleLineMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return true;
  }
  const parts = [meta.displayLine];
  if (meta.streamBackpressureDropped != null) {
    parts.push(meta.rawLine, STREAM_BACKPRESSURE_SEARCH_EXTRA);
  }
  const hay = parts.join(" ").toLowerCase();
  return hay.includes(q);
}
