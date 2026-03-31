// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  cursorInsideMustache,
  getExpressionCompletions,
  GC_EXPRESSION_BUILTIN_NAMES,
  scanExpressionTemplateSyntax,
} from "./expressionAutocomplete";

describe("cursorInsideMustache", () => {
  it("is false outside braces", () => {
    expect(cursorInsideMustache("foo", 3)).toBe(false);
  });

  it("is true between open and close", () => {
    expect(cursorInsideMustache("{{ x }}", 4)).toBe(true);
  });

  it("is false after closing", () => {
    expect(cursorInsideMustache("{{ x }} tail", 8)).toBe(false);
  });
});

describe("getExpressionCompletions", () => {
  const ids = ["task-a", "start-1"];

  it("suggests roots after dollar", () => {
    const m = getExpressionCompletions("$j", 2, ids);
    expect(m).not.toBeNull();
    expect(m!.items.some((i) => i.insert === "$json")).toBe(true);
    expect(m!.from).toBe(0);
    expect(m!.to).toBe(2);
  });

  it("completes $node bracket with node ids", () => {
    const text = 'pre $node["tas';
    const m = getExpressionCompletions(text, text.length, ids);
    expect(m).not.toBeNull();
    expect(m!.items.map((i) => i.insert)).toContain('$node["task-a"]');
    expect(m!.from).toBe(text.indexOf("$node"));
    expect(m!.to).toBe(text.length);
  });

  it("matches builtins at identifier boundary", () => {
    const text = "trim";
    const m = getExpressionCompletions(text, text.length, ids);
    expect(m).not.toBeNull();
    expect(m!.items.some((i) => i.insert === "trim")).toBe(true);
  });

  it("force palette includes builtins and roots", () => {
    const m = getExpressionCompletions("", 0, ids, { forcePalette: true });
    expect(m).not.toBeNull();
    expect(m!.items.some((i) => i.insert === "$json")).toBe(true);
    expect(m!.items.some((i) => i.insert === "upper")).toBe(true);
    expect(m!.from).toBe(0);
    expect(m!.to).toBe(0);
  });

  it("builtin list is non-empty and sorted", () => {
    expect(GC_EXPRESSION_BUILTIN_NAMES.length).toBe(23);
    const copy = [...GC_EXPRESSION_BUILTIN_NAMES];
    copy.sort((a, b) => a.localeCompare(b));
    expect(GC_EXPRESSION_BUILTIN_NAMES.every((n, i) => n === copy[i])).toBe(true);
  });
});

describe("scanExpressionTemplateSyntax", () => {
  it("returns null when no mustache", () => {
    expect(scanExpressionTemplateSyntax("$json.foo")).toBeNull();
  });

  it("detects unclosed mustache", () => {
    expect(scanExpressionTemplateSyntax("{{ $json.a")).toEqual({ kind: "unclosed_mustache" });
  });

  it("detects stray close", () => {
    expect(scanExpressionTemplateSyntax("x}}")).toEqual({ kind: "stray_close_mustache" });
  });

  it("detects unbalanced parens inside block", () => {
    expect(scanExpressionTemplateSyntax("{{ ceil(1 }}")).toEqual({ kind: "unbalanced_parens" });
  });

  it("allows balanced template", () => {
    expect(scanExpressionTemplateSyntax("{{ ceil(1) }}")).toBeNull();
  });
});
