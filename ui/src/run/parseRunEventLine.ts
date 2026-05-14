// Copyright GraphCaster. All Rights Reserved.

let droppedEventLineCount = 0;

/** Always-warn for the first `ALWAYS_WARN_THRESHOLD` drops, then 1-per-`SAMPLED_WARN_EVERY` to avoid log spam. */
const ALWAYS_WARN_THRESHOLD = 10;
const SAMPLED_WARN_EVERY = 100;

export function getDroppedEventLineCount(): number {
  return droppedEventLineCount;
}

export function resetDroppedEventLineCount(): void {
  droppedEventLineCount = 0;
}

export function parseRunEventLine(line: string): unknown | null {
  const s = line.trim();
  if (s.length === 0) {
    return null;
  }
  try {
    return JSON.parse(s) as unknown;
  } catch {
    droppedEventLineCount += 1;
    if (
      droppedEventLineCount <= ALWAYS_WARN_THRESHOLD ||
      droppedEventLineCount % SAMPLED_WARN_EVERY === 0
    ) {
      console.warn(
        `[graph-caster] dropped malformed NDJSON line (#${droppedEventLineCount}): ${s.slice(0, 200)}`,
      );
    }
    return null;
  }
}

export function peekRootGraphIdFromNdjson(ndjson: string): string | null {
  for (const raw of ndjson.split(/\r?\n/)) {
    const v = parseRunEventLine(raw);
    if (v == null || typeof v !== "object" || Array.isArray(v)) {
      continue;
    }
    const o = v as Record<string, unknown>;
    if (o.type !== "run_started") {
      continue;
    }
    const g = o.rootGraphId;
    if (typeof g !== "string") {
      return null;
    }
    const t = g.trim();
    return t === "" ? null : t;
  }
  return null;
}
