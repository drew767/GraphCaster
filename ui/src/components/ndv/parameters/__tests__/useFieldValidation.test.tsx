// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params && Object.keys(params).length) {
        return `${key}:${JSON.stringify(params)}`;
      }
      return key;
    },
  }),
}));

import { useFieldValidation, validateField } from "../useFieldValidation";

describe("validateField (pure)", () => {
  it("returns null when schema is undefined", () => {
    expect(validateField("x", undefined)).toBeNull();
  });

  it("required + empty string → error", () => {
    expect(validateField("", { required: true })).toEqual({
      key: "app.ndv.validation.required",
    });
  });

  it("required + null → error", () => {
    expect(validateField(null, { required: true })).toEqual({
      key: "app.ndv.validation.required",
    });
  });

  it("required + non-empty → no error", () => {
    expect(validateField("hello", { required: true })).toBeNull();
  });

  it("minLength below threshold → error", () => {
    expect(validateField("ab", { minLength: 3 })).toMatchObject({
      key: "app.ndv.validation.minLength",
      params: { min: 3 },
    });
  });

  it("maxLength above threshold → error", () => {
    expect(validateField("abcdef", { maxLength: 3 })).toMatchObject({
      key: "app.ndv.validation.maxLength",
      params: { max: 3 },
    });
  });

  it("pattern mismatch → error", () => {
    expect(validateField("abc", { pattern: "^[0-9]+$" })).toEqual({
      key: "app.ndv.validation.pattern",
    });
  });

  it("pattern match → no error", () => {
    expect(validateField("123", { pattern: "^[0-9]+$" })).toBeNull();
  });
});

describe("useFieldValidation hook", () => {
  it("required + empty value → returns error string", () => {
    const { result } = renderHook(() =>
      useFieldValidation("", { required: true }),
    );
    expect(result.current.error).toBe("app.ndv.validation.required");
    expect(result.current.dirty).toBe(false);
  });

  it("non-empty value → no error", () => {
    const { result } = renderHook(() =>
      useFieldValidation("hello", { required: true }),
    );
    expect(result.current.error).toBeNull();
  });

  it("onBlur flips dirty flag", () => {
    const { result } = renderHook(() =>
      useFieldValidation("", { required: true }),
    );
    expect(result.current.dirty).toBe(false);
    act(() => {
      result.current.onBlur();
    });
    expect(result.current.dirty).toBe(true);
  });
});
