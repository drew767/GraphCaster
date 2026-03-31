// Copyright GraphCaster. All Rights Reserved.

/**
 * Autocomplete helpers for GraphCaster expressions ($json / $node / $env, builtins)
 * aligned with `python/graph_caster/expression/functions.py` and edge/mustache hints.
 */

export type ExpressionCompletionKind = "root" | "builtin" | "node_ref";

export type ExpressionCompletion = {
  label: string;
  insert: string;
  kind: ExpressionCompletionKind;
};

/** Builtin call names exposed by the Python expression evaluator (keep in sync with EXPRESSION_FUNCTIONS). */
export const GC_EXPRESSION_BUILTIN_NAMES: readonly string[] = [
  "ceil",
  "coalesce",
  "contains",
  "default",
  "ends_with",
  "extract",
  "first",
  "flatten",
  "floor",
  "format_date",
  "if",
  "json_parse",
  "json_stringify",
  "join",
  "last",
  "lower",
  "now",
  "replace",
  "split",
  "starts_with",
  "trim",
  "unique",
  "upper",
].sort();

const ROOTS: readonly string[] = ["$json", "$node", "$env"];

function isIdentChar(c: string): boolean {
  return /[a-zA-Z0-9_]/.test(c);
}

function isIdentStartBoundary(text: string, index: number): boolean {
  if (index < 0) {
    return true;
  }
  const ch = text[index];
  return !isIdentChar(ch);
}

/** True if cursor is inside `{{ ... }}` that is not yet closed before cursor. */
export function cursorInsideMustache(text: string, cursor: number): boolean {
  const before = text.slice(0, cursor);
  const open = before.lastIndexOf("{{");
  if (open < 0) {
    return false;
  }
  const close = before.lastIndexOf("}}");
  return open > close;
}

export type ExpressionCompletionMatch = {
  items: ExpressionCompletion[];
  from: number;
  to: number;
};

function matchNodeBracket(text: string, cursor: number, nodeIds: readonly string[]): ExpressionCompletionMatch | null {
  const before = text.slice(0, cursor);
  const reDq = /\$node\s*\[\s*"([^"]*)$/;
  const reSq = /\$node\s*\[\s*'([^']*)$/;
  let m = before.match(reDq);
  let quote: '"' | "'" = '"';
  if (!m) {
    m = before.match(reSq);
    quote = "'";
  }
  if (!m) {
    return null;
  }
  const partial = m[1];
  const matchStart = before.length - m[0].length;
  const ids = [...new Set(nodeIds)]
    .filter((id) => id.includes(partial) || partial === "")
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 24);
  const items: ExpressionCompletion[] = ids.map((id) => ({
    label: `$node[${quote}${id}${quote}]`,
    insert:
      quote === '"'
        ? `$node["${id}"]`
        : `$node['${id}']`,
    kind: "node_ref",
  }));
  /** Replace from start of `$node[` through cursor so unfinished `["partial` becomes a full ref. */
  return items.length === 0 ? null : { items, from: matchStart, to: cursor };
}

function matchDollarRoots(
  text: string,
  cursor: number,
  roots: readonly string[],
): ExpressionCompletionMatch | null {
  let i = cursor - 1;
  while (i >= 0 && isIdentChar(text[i])) {
    i -= 1;
  }
  if (i < 0 || text[i] !== "$") {
    return null;
  }
  if (!isIdentStartBoundary(text, i - 1)) {
    return null;
  }
  const prefix = text.slice(i + 1, cursor).toLowerCase();
  const items: ExpressionCompletion[] = roots
    .filter((r) => r.slice(1).toLowerCase().startsWith(prefix))
    .map((r) => ({ label: r, insert: r, kind: "root" as const }));
  return items.length === 0 ? null : { items, from: i, to: cursor };
}

function matchBuiltins(text: string, cursor: number): ExpressionCompletionMatch | null {
  let j = cursor - 1;
  while (j >= 0 && isIdentChar(text[j])) {
    j -= 1;
  }
  const start = j + 1;
  const prefix = text.slice(start, cursor);
  if (prefix.length === 0) {
    return null;
  }
  if (!isIdentStartBoundary(text, start - 1)) {
    return null;
  }
  const pl = prefix.toLowerCase();
  const items: ExpressionCompletion[] = GC_EXPRESSION_BUILTIN_NAMES.filter((name) =>
    name.toLowerCase().startsWith(pl),
  ).map((name) => ({ label: name, insert: name, kind: "builtin" as const }));
  return items.length === 0 ? null : { items, from: start, to: cursor };
}

function forcePalette(nodeIds: readonly string[]): ExpressionCompletionMatch {
  const roots: ExpressionCompletion[] = ROOTS.map((r) => ({ label: r, insert: r, kind: "root" as const }));
  const builtins: ExpressionCompletion[] = GC_EXPRESSION_BUILTIN_NAMES.map((name) => ({
    label: name,
    insert: name,
    kind: "builtin" as const,
  }));
  const ids = [...new Set(nodeIds)].sort((a, b) => a.localeCompare(b)).slice(0, 16);
  const nodes: ExpressionCompletion[] = ids.map((id) => ({
    label: `$node["${id}"]`,
    insert: `$node["${id}"]`,
    kind: "node_ref" as const,
  }));
  return {
    items: [...roots, ...nodes, ...builtins],
    from: 0,
    to: 0,
  };
}

/**
 * Returns a replacement range [from, to) and suggestions for the expression/Mustache field at `cursor`.
 * When `opts.forcePalette` is true (e.g. Ctrl+Space), returns a full palette with dummy range 0..0 — caller inserts at cursor.
 */
export function getExpressionCompletions(
  text: string,
  cursor: number,
  nodeIds: readonly string[],
  opts?: { forcePalette?: boolean },
): ExpressionCompletionMatch | null {
  const c = Math.max(0, Math.min(cursor, text.length));
  if (opts?.forcePalette) {
    return forcePalette(nodeIds);
  }

  const bracket = matchNodeBracket(text, c, nodeIds);
  if (bracket) {
    return bracket;
  }

  const dollar = matchDollarRoots(text, c, ROOTS);
  if (dollar) {
    return dollar;
  }

  const builtins = matchBuiltins(text, c);
  if (builtins) {
    return builtins;
  }

  return null;
}
