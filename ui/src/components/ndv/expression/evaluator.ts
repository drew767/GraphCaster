// Copyright GraphCaster. All Rights Reserved.

/**
 * Lightweight stub evaluator for `{{ ... }}` expressions used by the NDV
 * preview affordances (hover tooltip, result strip).
 *
 * It is intentionally tiny — it understands `$json.<path>` and resolves the
 * path against the supplied context input item. Anything else is returned
 * verbatim so users still see something useful.
 */

export interface EvaluationContext {
  /** Current input item (the value behind `$json`). */
  inputItem?: unknown;
}

export interface EvaluationOk {
  ok: true;
  value: unknown;
}

export interface EvaluationError {
  ok: false;
  error: string;
}

export type EvaluationResult = EvaluationOk | EvaluationError;

/**
 * Walk `obj` along the dot-separated `path`. Supports numeric segments for
 * array access (e.g. "items.0.name"). Returns `undefined` if a segment can't
 * be resolved.
 */
export function getPath(obj: unknown, path: string): unknown {
  if (path === "" || path === undefined) return obj;
  const segments = path.split(".").filter((s) => s.length > 0);
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return current;
}

const EXPR_RE = /\{\{\s*([^}]+?)\s*\}\}/;

/**
 * Extract the inner expression text from a string containing `{{ ... }}`.
 * Returns null if the string contains no expression block.
 */
export function extractExpression(text: string): string | null {
  const m = text.match(EXPR_RE);
  return m ? m[1].trim() : null;
}

/**
 * Try to resolve an expression to a value.
 *
 * Supported patterns:
 *   - `$json` — returns the entire input item.
 *   - `$json.<dot.path>` — walks the input item.
 *   - bare identifier or anything else — returned as-is (no JS execution).
 */
export function evaluateExpression(
  text: string,
  context: EvaluationContext,
): EvaluationResult {
  if (typeof text !== "string") {
    return { ok: false, error: "expression must be a string" };
  }

  const inner = extractExpression(text) ?? text.trim();
  if (!inner) {
    return { ok: false, error: "empty expression" };
  }

  // Match $json or $json.<path>
  const jsonMatch = inner.match(/^\$json(?:\.(.+))?$/);
  if (jsonMatch) {
    const path = jsonMatch[1] ?? "";
    const value = getPath(context.inputItem, path);
    if (value === undefined) {
      return { ok: false, error: `cannot resolve ${inner}` };
    }
    return { ok: true, value };
  }

  return { ok: false, error: `cannot evaluate ${inner}` };
}

/** Format an evaluated value for display in a tooltip / strip. */
export function formatEvaluated(value: unknown, max = 80): string {
  let s: string;
  if (value === null) s = "null";
  else if (value === undefined) s = "undefined";
  else if (typeof value === "string") s = value;
  else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  if (s.length > max) return s.slice(0, max - 1) + "…";
  return s;
}
