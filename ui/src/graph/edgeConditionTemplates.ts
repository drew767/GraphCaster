// Copyright GraphCaster. All Rights Reserved.

export const MAX_TEMPLATE_PLACEHOLDERS = 32;

/** Same cap as Python `edge_conditions.MAX_EDGE_CONDITION_CHARS` — longer strings are not analyzed. */
export const MAX_EDGE_CONDITION_CHARS = 65536;

const PATH_SEGMENT = "[a-zA-Z_][a-zA-Z0-9_]*";
const DOTTED_PATH = `${PATH_SEGMENT}(?:\\.${PATH_SEGMENT})*`;

const RE_TEMPLATE_TRUTHY = new RegExp(`^\\s*\\{\\{\\s*(${DOTTED_PATH})\\s*\\}\\}\\s*$`);
const RE_TEMPLATE_CMP = new RegExp(
  `^\\s*\\{\\{\\s*(${DOTTED_PATH})\\s*\\}\\}\\s*(==|!=|<=|>=|<|>)\\s*(.+?)\\s*$`,
);
const RE_ALL_PLACEHOLDERS = new RegExp(`\\{\\{\\s*(${DOTTED_PATH})\\s*\\}\\}`, "g");

export function extractTemplatePaths(condition: string): string[] {
  if (condition.trim().length > MAX_EDGE_CONDITION_CHARS) {
    return [];
  }
  if (!condition.includes("{{")) {
    return [];
  }
  return [...condition.matchAll(RE_ALL_PLACEHOLDERS)].map((m) => m[1]);
}

export type TemplateConditionAnalysis =
  | "none"
  | "ok"
  | "unclosed"
  | "too_many"
  | "too_long"
  | "invalid";

export function analyzeTemplateCondition(condition: string): TemplateConditionAnalysis {
  const s = condition.trim();
  if (s.length > MAX_EDGE_CONDITION_CHARS) {
    return s.includes("{{") ? "too_long" : "none";
  }
  if (!s.includes("{{")) {
    return "none";
  }
  const paths = extractTemplatePaths(condition);
  if (paths.length === 0) {
    return "unclosed";
  }
  if (paths.length > MAX_TEMPLATE_PLACEHOLDERS) {
    return "too_many";
  }
  if (RE_TEMPLATE_TRUTHY.test(s) || RE_TEMPLATE_CMP.test(s)) {
    return "ok";
  }
  return "invalid";
}
