// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "./types";

export function collectRefTargetsFromGraphDocument(doc: GraphDocumentJson): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of doc.nodes ?? []) {
    if (n.type !== "graph_ref") {
      continue;
    }
    const d = n.data;
    if (!d || typeof d !== "object") {
      continue;
    }
    const raw = (d as Record<string, unknown>).targetGraphId ?? (d as Record<string, unknown>).graphId;
    if (raw === undefined || raw === null) {
      continue;
    }
    const t = String(raw).trim();
    if (t === "") {
      continue;
    }
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

const _WHITE = 0;
const _GRAY = 1;
const _BLACK = 2;

function _lexLess(a: readonly string[], b: readonly string[]): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) {
      return true;
    }
    if (a[i] > b[i]) {
      return false;
    }
  }
  return a.length < b.length;
}

function _canonRotateCycle(cycle: string[]): string[] {
  if (cycle.length <= 1) {
    return cycle;
  }
  let best: string[] | null = null;
  for (let i = 0; i < cycle.length; i++) {
    const rot = cycle.slice(i).concat(cycle.slice(0, i));
    if (best === null || _lexLess(rot, best)) {
      best = rot;
    }
  }
  return best ?? cycle;
}

export function findWorkspaceGraphRefCycle(
  entries: readonly { graphId: string; refTargets: readonly string[] }[],
): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of entries) {
    if (adj.has(e.graphId)) {
      continue;
    }
    const seen = new Set<string>();
    const list: string[] = [];
    for (const t of e.refTargets) {
      if (!seen.has(t)) {
        seen.add(t);
        list.push(t);
      }
    }
    adj.set(e.graphId, list);
  }
  const vertexSet = new Set<string>();
  for (const [k, vs] of adj) {
    vertexSet.add(k);
    for (const v of vs) {
      vertexSet.add(v);
    }
  }
  const color = new Map<string, number>();
  const stackPos = new Map<string, number>();
  let found: string[] | null = null;

  function dfs(u: string, stack: string[]): void {
    if (found !== null) {
      return;
    }
    color.set(u, _GRAY);
    stack.push(u);
    stackPos.set(u, stack.length - 1);
    for (const v of adj.get(u) ?? []) {
      if (found !== null) {
        break;
      }
      const c = color.get(v) ?? _WHITE;
      if (c === _WHITE) {
        dfs(v, stack);
      } else if (c === _GRAY) {
        const i = stackPos.get(v);
        if (i !== undefined) {
          found = _canonRotateCycle(stack.slice(i));
        }
      }
    }
    stack.pop();
    stackPos.delete(u);
    color.set(u, _BLACK);
  }

  for (const v of [...vertexSet].sort()) {
    if ((color.get(v) ?? _WHITE) === _WHITE) {
      dfs(v, []);
      if (found !== null) {
        break;
      }
    }
  }
  return found;
}
