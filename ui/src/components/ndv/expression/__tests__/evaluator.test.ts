// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect } from "vitest";

import {
  evaluateExpression,
  formatEvaluated,
  getPath,
  extractExpression,
} from "../evaluator";

describe("getPath", () => {
  it("returns root for empty path", () => {
    expect(getPath({ a: 1 }, "")).toEqual({ a: 1 });
  });

  it("walks a dot path on an object", () => {
    expect(getPath({ user: { email: "x@y.z" } }, "user.email")).toBe("x@y.z");
  });

  it("walks a numeric segment on arrays", () => {
    expect(getPath({ items: [{ name: "a" }, { name: "b" }] }, "items.1.name")).toBe("b");
  });

  it("returns undefined when a segment is missing", () => {
    expect(getPath({ a: 1 }, "a.b.c")).toBeUndefined();
  });
});

describe("extractExpression", () => {
  it("extracts the inner expression", () => {
    expect(extractExpression("{{ $json.user.email }}")).toBe("$json.user.email");
  });

  it("returns null when no expression is present", () => {
    expect(extractExpression("plain text")).toBeNull();
  });
});

describe("evaluateExpression", () => {
  it("resolves $json.<path> against the input item", () => {
    const result = evaluateExpression("{{ $json.user.email }}", {
      inputItem: { user: { email: "alice@example.com" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("alice@example.com");
  });

  it("resolves bare $json to the whole input item", () => {
    const result = evaluateExpression("{{ $json }}", { inputItem: { a: 1 } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("returns an error when the path cannot be resolved", () => {
    const result = evaluateExpression("{{ $json.missing }}", { inputItem: {} });
    expect(result.ok).toBe(false);
  });

  it("returns an error for unsupported expressions", () => {
    const result = evaluateExpression("{{ Math.random() }}", { inputItem: {} });
    expect(result.ok).toBe(false);
  });
});

describe("formatEvaluated", () => {
  it("formats null and undefined", () => {
    expect(formatEvaluated(null)).toBe("null");
    expect(formatEvaluated(undefined)).toBe("undefined");
  });

  it("returns strings as-is when short", () => {
    expect(formatEvaluated("hello")).toBe("hello");
  });

  it("truncates long strings with ellipsis", () => {
    const long = "x".repeat(120);
    const out = formatEvaluated(long, 80);
    expect(out.length).toBe(80);
    expect(out.endsWith("…")).toBe(true);
  });

  it("JSON-stringifies objects", () => {
    expect(formatEvaluated({ a: 1 })).toBe('{"a":1}');
  });
});
