// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  HANDLE_IN_DEFAULT,
  HANDLE_OUT_DEFAULT,
  HANDLE_OUT_ERROR,
} from "./handleContract";
import { coercePortKindOverride, portDataKindForSource, portDataKindForTarget } from "./portDataKinds";

describe("coercePortKindOverride (F18 phase 2)", () => {
  it("accepts enum and trims", () => {
    expect(coercePortKindOverride("json")).toBe("json");
    expect(coercePortKindOverride("  primitive  ")).toBe("primitive");
  });
  it("returns undefined for invalid", () => {
    expect(coercePortKindOverride(undefined)).toBeUndefined();
    expect(coercePortKindOverride("nope")).toBeUndefined();
    expect(coercePortKindOverride(3)).toBeUndefined();
  });
});

describe("portDataKind registry", () => {
  it("start out_default and task in_default are json", () => {
    expect(portDataKindForSource("start", HANDLE_OUT_DEFAULT)).toBe("json");
    expect(portDataKindForTarget("task", HANDLE_IN_DEFAULT)).toBe("json");
    expect(portDataKindForTarget("exit", HANDLE_IN_DEFAULT)).toBe("json");
  });

  it("start cannot be in_default target in contract; registry returns any", () => {
    expect(portDataKindForTarget("start", HANDLE_IN_DEFAULT)).toBe("any");
  });

  it("task out_error is any", () => {
    expect(portDataKindForSource("task", HANDLE_OUT_ERROR)).toBe("any");
  });

  it("unknown node type uses any for main flow handles", () => {
    expect(portDataKindForSource("custom_node", HANDLE_OUT_DEFAULT)).toBe("any");
    expect(portDataKindForTarget("custom_node", HANDLE_IN_DEFAULT)).toBe("any");
  });

  it("merge fork ai_route use json on default handles", () => {
    expect(portDataKindForSource("merge", HANDLE_OUT_DEFAULT)).toBe("json");
    expect(portDataKindForTarget("fork", HANDLE_IN_DEFAULT)).toBe("json");
    expect(portDataKindForSource("ai_route", HANDLE_OUT_DEFAULT)).toBe("json");
  });

  it("non-default handle ids are any", () => {
    expect(portDataKindForSource("task", "future_handle")).toBe("any");
    expect(portDataKindForTarget("task", "other_in")).toBe("any");
  });
});
