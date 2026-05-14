// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "../../ui/Select/Select";
import "./ParameterTypes.css";

export interface MultiOptionsOption {
  value: string;
  label: string;
}

export interface MultiOptionsInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: MultiOptionsOption[];
  disabled?: boolean;
}

export function MultiOptionsInput({
  value,
  onChange,
  options,
  disabled = false,
}: MultiOptionsInputProps) {
  const { t } = useTranslation();

  const selected = useMemo(() => new Set(value), [value]);

  const toggle = useCallback(
    (val: string) => {
      if (disabled) return;
      const next = selected.has(val)
        ? value.filter((v) => v !== val)
        : [...value, val];
      onChange(next);
    },
    [value, onChange, selected, disabled],
  );

  const unselected = useMemo(
    () => options.filter((o) => !selected.has(o.value)),
    [options, selected],
  );

  const handleAdd = useCallback(
    (val: string) => {
      if (!val) return;
      if (!selected.has(val)) onChange([...value, val]);
    },
    [value, onChange, selected],
  );

  return (
    <div className="gc-param-multi-options" data-testid="param-multi-options">
      <div className="gc-param-multi-options__chips">
        {options
          .filter((o) => selected.has(o.value))
          .map((o) => (
            <button
              type="button"
              key={o.value}
              className="gc-param-multi-options__chip gc-param-multi-options__chip--selected"
              onClick={() => toggle(o.value)}
              disabled={disabled}
              data-testid={`param-multi-options-chip-${o.value}`}
              data-selected="true"
            >
              {o.label}
            </button>
          ))}
      </div>
      {unselected.length > 0 && (
        <div className="gc-param-multi-options__add">
          <Select
            value=""
            onValueChange={handleAdd}
            options={[
              { value: "", label: t("app.ndv.parameters.types.multiOptions.selectOption") },
              ...unselected,
            ]}
            disabled={disabled}
            aria-label={t("app.ndv.parameters.types.multiOptions.add")}
            data-testid="param-multi-options-add"
          />
        </div>
      )}
    </div>
  );
}

export default MultiOptionsInput;
void React;
