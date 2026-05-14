// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";
import { PROMPTABLE_FIELDS, isPromptableField } from "../promptable_fields";

describe("PROMPTABLE_FIELDS mapping", () => {
  it("prompt_concat maps to template", () => {
    expect(PROMPTABLE_FIELDS["prompt_concat"]).toContain("template");
  });

  it("llm_agent maps to systemPrompt", () => {
    expect(PROMPTABLE_FIELDS["llm_agent"]).toContain("systemPrompt");
  });

  it("agent maps to systemPrompt", () => {
    expect(PROMPTABLE_FIELDS["agent"]).toContain("systemPrompt");
  });

  it("ai_route maps to systemPrompt", () => {
    expect(PROMPTABLE_FIELDS["ai_route"]).toContain("systemPrompt");
  });

  it("task has no promptable fields", () => {
    expect(PROMPTABLE_FIELDS["task"]).toBeUndefined();
  });
});

describe("isPromptableField", () => {
  it("returns true for agent / systemPrompt", () => {
    expect(isPromptableField("agent", "systemPrompt")).toBe(true);
  });

  it("returns true for prompt_concat / template", () => {
    expect(isPromptableField("prompt_concat", "template")).toBe(true);
  });

  it("returns false for unknown node type", () => {
    expect(isPromptableField("start", "systemPrompt")).toBe(false);
  });

  it("returns false for wrong field on known type", () => {
    expect(isPromptableField("agent", "command")).toBe(false);
  });
});
