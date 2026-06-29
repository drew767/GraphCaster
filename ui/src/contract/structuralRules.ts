// Copyright GraphCaster. All Rights Reserved.
//
// Declarative structural-rule engine — TypeScript side of the parity pair.
// Python equivalent: python/graph_caster/structural_rules_engine.py
//
// The catalog `schemas/structural-rules.json` is the language-neutral list of
// known rules (id + severity + appliesTo). The actual rule logic still lives
// in `ui/src/graph/structureWarnings.ts` (function `findStructureIssues`) for
// now. This engine reads the catalog, runs `findStructureIssues`, and filters
// its output down to the ids declared in the catalog — keeping the two engines
// in lock-step via the shared catalog.
//
// Migration status: 5 of 23 rules ported. Remaining rules still emit through
// `findStructureIssues` and are NOT yet filtered out by this engine — they
// pass through but their `severity` is not annotated by the catalog. When a
// remaining rule is migrated, it gains an entry in `structural-rules.json`
// and the catalog's `severity` is applied here.

import structuralRulesCatalog from "@schemas/structural-rules.json";
import { findStructureIssues, type StructureIssue } from "../graph/structureWarnings";
import type { GraphDocumentJson } from "../graph/types";

export type StructuralRuleSeverity = "warning" | "error";

export interface StructuralRule {
  readonly id: string;
  readonly severity: StructuralRuleSeverity;
  readonly appliesTo: string;
  readonly params: Record<string, unknown>;
}

export interface StructuralRulesCatalog {
  readonly version: number;
  readonly rules: readonly StructuralRule[];
}

export type StructuralWarning = StructureIssue & {
  readonly severity: StructuralRuleSeverity;
};

const RAW_CATALOG = structuralRulesCatalog as unknown as {
  version: number;
  rules: ReadonlyArray<{
    id: string;
    severity: StructuralRuleSeverity;
    appliesTo: string;
    params?: Record<string, unknown>;
  }>;
};

export function loadRulesCatalog(): StructuralRulesCatalog {
  return {
    version: RAW_CATALOG.version,
    rules: RAW_CATALOG.rules.map((r) => ({
      id: r.id,
      severity: r.severity,
      appliesTo: r.appliesTo,
      params: r.params ?? {},
    })),
  };
}

const CATALOG_RULE_IDS: ReadonlySet<string> = new Set(RAW_CATALOG.rules.map((r) => r.id));

const SEVERITY_BY_ID: ReadonlyMap<string, StructuralRuleSeverity> = new Map(
  RAW_CATALOG.rules.map((r) => [r.id, r.severity] as const),
);

/**
 * Run all catalog-driven rules against `doc`.
 *
 * Returns warnings whose `kind` is registered in `schemas/structural-rules.json`,
 * each annotated with the catalog `severity`. Rules not in the catalog (the 18
 * still-pending migration) are dropped here; consumers that need the full
 * legacy set should keep calling `findStructureIssues` directly.
 */
export function validateStructural(doc: GraphDocumentJson): StructuralWarning[] {
  const all = findStructureIssues(doc);
  const out: StructuralWarning[] = [];
  for (const issue of all) {
    if (!CATALOG_RULE_IDS.has(issue.kind)) {
      continue;
    }
    const severity = SEVERITY_BY_ID.get(issue.kind) ?? "warning";
    out.push({ ...issue, severity } as StructuralWarning);
  }
  return out;
}

export function listRuleIds(): readonly string[] {
  return Array.from(CATALOG_RULE_IDS);
}
