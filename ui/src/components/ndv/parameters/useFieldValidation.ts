// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface FieldValidationSchema {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  /** Regex source string or RegExp. */
  pattern?: string | RegExp;
}

export interface FieldValidationResult {
  error: string | null;
  onBlur: () => void;
  dirty: boolean;
  /** Reset dirty flag (e.g. after a successful save). */
  reset: () => void;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Pure validator usable outside React (handy for unit tests).
 * Returns the i18n key + interpolation params, or null when valid.
 */
export function validateField(
  value: unknown,
  schema: FieldValidationSchema | undefined,
): { key: string; params?: Record<string, unknown> } | null {
  if (!schema) return null;

  if (schema.required && isEmpty(value)) {
    return { key: "app.ndv.validation.required" };
  }

  if (typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      return { key: "app.ndv.validation.minLength", params: { min: schema.minLength } };
    }
    if (
      typeof schema.maxLength === "number" &&
      value.length > schema.maxLength
    ) {
      return { key: "app.ndv.validation.maxLength", params: { max: schema.maxLength } };
    }
    if (schema.pattern && value.length > 0) {
      const re =
        schema.pattern instanceof RegExp ? schema.pattern : new RegExp(schema.pattern);
      if (!re.test(value)) {
        return { key: "app.ndv.validation.pattern" };
      }
    }
  }

  return null;
}

export function useFieldValidation(
  value: unknown,
  schema: FieldValidationSchema | undefined,
): FieldValidationResult {
  const { t } = useTranslation();
  const [dirty, setDirty] = useState(false);

  const validation = useMemo(() => validateField(value, schema), [value, schema]);

  const error = useMemo<string | null>(() => {
    if (!validation) return null;
    return t(validation.key, validation.params ?? {});
  }, [validation, t]);

  const onBlur = useCallback(() => {
    setDirty(true);
  }, []);

  const reset = useCallback(() => {
    setDirty(false);
  }, []);

  return { error, onBlur, dirty, reset };
}
