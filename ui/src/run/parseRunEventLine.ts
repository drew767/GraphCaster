// Copyright GraphCaster. All Rights Reserved.

export function parseRunEventLine(line: string): unknown | null {
  const s = line.trim();
  if (s.length === 0) {
    return null;
  }
  try {
    return JSON.parse(s) as unknown;
  } catch {
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
