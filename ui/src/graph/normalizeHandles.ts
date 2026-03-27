// Copyright GraphCaster. All Rights Reserved.

/** XYFlow `Connection` / `Edge` handle id after trim; empty → fallback (matches export). */
export function flowConnectionHandle(v: string | null | undefined, fallback: string): string {
  return (v ?? "").trim() || fallback;
}

/** Python: `e.get("sourceHandle") or e.get("source_handle")` — first truthy scalar / non-empty string. */
export function pickEdgeHandleRaw(
  er: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): unknown {
  for (const key of [camelKey, snakeKey]) {
    if (!(key in er)) {
      continue;
    }
    const v = er[key];
    if (v === undefined || v === null || v === false || v === 0) {
      continue;
    }
    if (typeof v === "string" && v.trim() === "") {
      continue;
    }
    return v;
  }
  return undefined;
}

/** Final step: `str(chosen or fallback)` for runner-visible handle ids. */
export function normalizeEdgeHandleValue(v: unknown, fallback: string): string {
  if (v === undefined || v === null || v === false || v === 0) {
    return fallback;
  }
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? fallback : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  if (v === true) {
    return "True";
  }
  if (typeof v === "object") {
    return fallback;
  }
  return fallback;
}
