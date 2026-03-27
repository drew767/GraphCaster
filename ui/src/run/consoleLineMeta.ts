// Copyright GraphCaster. All Rights Reserved.

import { parseRunEventLine } from "./parseRunEventLine";

export const STDERR_PREFIX = "[stderr] ";

export type ConsoleLineMeta = {
  rawLine: string;
  displayLine: string;
  isStderr: boolean;
  parsedType: string | null;
  nodeId: string | null;
  isErrorLike: boolean;
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

  if (typeStr === "error" || typeStr === "process_failed") {
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
  const { isStderr, payload } = splitStderrPrefix(rawLine);
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
    }
  }
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
  return meta.displayLine.toLowerCase().includes(q);
}
