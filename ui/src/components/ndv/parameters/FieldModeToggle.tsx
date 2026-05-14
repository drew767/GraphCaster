// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

import { Tooltip } from "../../ui/Tooltip/Tooltip";
import { useNdvStore, type FieldMode } from "../useNdvStore";

export interface FieldModeToggleProps {
  paramKey: string;
  defaultMode?: FieldMode;
  className?: string;
}

export function FieldModeToggle({
  paramKey,
  defaultMode = "fixed",
  className,
}: FieldModeToggleProps) {
  const { t } = useTranslation();
  const mode = useNdvStore((s) => s.fieldMode[paramKey] ?? defaultMode);
  const setFieldMode = useNdvStore((s) => s.setFieldMode);

  const isExpression = mode === "expression";
  const next: FieldMode = isExpression ? "fixed" : "expression";
  const label = isExpression
    ? t("app.ndv.fieldMode.switchToFixed")
    : t("app.ndv.fieldMode.switchToExpression");

  const classes = [
    "gc-field-mode-toggle",
    isExpression
      ? "gc-field-mode-toggle--expression"
      : "gc-field-mode-toggle--fixed",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tooltip content={label}>
      <button
        type="button"
        className={classes}
        aria-label={label}
        aria-pressed={isExpression}
        data-mode={mode}
        data-testid={`field-mode-toggle-${paramKey}`}
        onClick={() => setFieldMode(paramKey, next)}
      >
        <span aria-hidden="true">{isExpression ? "ƒ" : "="}</span>
      </button>
    </Tooltip>
  );
}
