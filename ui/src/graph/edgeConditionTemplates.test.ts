// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  analyzeTemplateCondition,
  extractTemplatePaths,
  MAX_EDGE_CONDITION_CHARS,
  MAX_TEMPLATE_PLACEHOLDERS,
} from "./edgeConditionTemplates";

describe("extractTemplatePaths", () => {
  it("matches Python examples", () => {
    expect(extractTemplatePaths("{{node_outputs.t1.processResult.exitCode}} == 0")).toEqual([
      "node_outputs.t1.processResult.exitCode",
    ]);
    expect(extractTemplatePaths("true")).toEqual([]);
  });
});

describe("analyzeTemplateCondition", () => {
  it("ok for truthy and comparison", () => {
    expect(analyzeTemplateCondition("{{node_outputs.a.x}}")).toBe("ok");
    expect(analyzeTemplateCondition("{{node_outputs.t1.processResult.exitCode}} == 0")).toBe("ok");
  });

  it("none without mustache", () => {
    expect(analyzeTemplateCondition('{"==":[1,1]}')).toBe("none");
  });

  it("unclosed", () => {
    expect(analyzeTemplateCondition("{{node_outputs.t1")).toBe("unclosed");
  });

  it("too_many placeholders", () => {
    const parts = Array.from({ length: MAX_TEMPLATE_PLACEHOLDERS + 1 }, (_, i) => `{{node_outputs.n${i}}}`);
    expect(analyzeTemplateCondition(parts.join(" "))).toBe("too_many");
  });

  it("invalid multi-placeholder form", () => {
    expect(analyzeTemplateCondition("{{a}} {{b}}")).toBe("invalid");
  });

  it("too_long when mustache and trim exceeds cap", () => {
    const pad = "x".repeat(MAX_EDGE_CONDITION_CHARS);
    expect(analyzeTemplateCondition(`{{a}}${pad}`)).toBe("too_long");
  });

  it("none when over cap but no mustache", () => {
    expect(analyzeTemplateCondition("x".repeat(MAX_EDGE_CONDITION_CHARS + 1))).toBe("none");
  });

  it("comparison operators still ok", () => {
    expect(analyzeTemplateCondition("{{node_outputs.a.x}} > 3")).toBe("ok");
    expect(analyzeTemplateCondition('{{node_outputs.a.status}} == "ok"')).toBe("ok");
  });

  it("prefix before mustache is invalid form", () => {
    expect(analyzeTemplateCondition("prefix {{a}} == 1")).toBe("invalid");
  });
});
