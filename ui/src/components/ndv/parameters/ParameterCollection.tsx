// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button/Button";
import { Input } from "../../ui/Input/Input";
import { InputNumber } from "../../ui/InputNumber/InputNumber";
import { Select } from "../../ui/Select/Select";
import { Switch } from "../../ui/Switch/Switch";
import "./ParameterTypes.css";

export interface CollectionChildField {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  options?: Array<{ value: string; label: string }>;
  defaultValue?: unknown;
}

export interface ParameterCollectionProps {
  value: Array<Record<string, unknown>>;
  onChange: (value: Array<Record<string, unknown>>) => void;
  children: CollectionChildField[];
  min?: number;
  max?: number;
  disabled?: boolean;
}

function fieldDefaultsForRow(
  children: CollectionChildField[],
  preset?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(preset ?? {}) };
  for (const child of children) {
    if (!(child.name in out) && child.defaultValue !== undefined) {
      out[child.name] = child.defaultValue;
    }
  }
  return out;
}

interface RowEditorProps {
  index: number;
  row: Record<string, unknown>;
  children: CollectionChildField[];
  onChange: (next: Record<string, unknown>) => void;
  onRemove: () => void;
  disabled?: boolean;
}

function RowEditor({
  index,
  row,
  children,
  onChange,
  onRemove,
  disabled,
}: RowEditorProps) {
  const { t } = useTranslation();

  const presentNames = useMemo(() => new Set(Object.keys(row)), [row]);
  const availableToAdd = useMemo(
    () => children.filter((c) => !presentNames.has(c.name)),
    [children, presentNames],
  );

  const addField = useCallback(
    (name: string) => {
      const child = children.find((c) => c.name === name);
      if (!child) return;
      onChange({ ...row, [name]: child.defaultValue ?? "" });
    },
    [children, row, onChange],
  );

  return (
    <div
      className="gc-param-collection__row"
      data-testid={`param-collection-row-${index}`}
    >
      <div className="gc-param-collection__row-fields">
        {children
          .filter((child) => presentNames.has(child.name))
          .map((child) => {
            const v = row[child.name];
            return (
              <div
                key={child.name}
                className="gc-param-collection__field-row"
                data-testid={`param-collection-field-${index}-${child.name}`}
              >
                <label className="gc-param-collection__field-label">
                  {child.label}
                </label>
                {child.type === "string" && (
                  <Input
                    value={typeof v === "string" ? v : ""}
                    onChange={(e) =>
                      onChange({ ...row, [child.name]: e.target.value })
                    }
                    disabled={disabled}
                    aria-label={child.label}
                    data-testid={`param-collection-input-${index}-${child.name}`}
                  />
                )}
                {child.type === "number" && (
                  <InputNumber
                    value={typeof v === "number" ? v : undefined}
                    onChange={(n) =>
                      onChange({ ...row, [child.name]: n ?? 0 })
                    }
                    disabled={disabled}
                    aria-label={child.label}
                    data-testid={`param-collection-input-${index}-${child.name}`}
                  />
                )}
                {child.type === "boolean" && (
                  <Switch
                    checked={typeof v === "boolean" ? v : false}
                    onCheckedChange={(b) =>
                      onChange({ ...row, [child.name]: b })
                    }
                    disabled={disabled}
                    label={child.label}
                    data-testid={`param-collection-input-${index}-${child.name}`}
                  />
                )}
                {child.type === "select" && (
                  <Select
                    value={typeof v === "string" ? v : ""}
                    onValueChange={(s) =>
                      onChange({ ...row, [child.name]: s })
                    }
                    options={child.options ?? []}
                    disabled={disabled}
                    aria-label={child.label}
                    data-testid={`param-collection-input-${index}-${child.name}`}
                  />
                )}
              </div>
            );
          })}
      </div>

      {availableToAdd.length > 0 && (
        <div className="gc-param-collection__add-field">
          <Select
            value=""
            onValueChange={(name) => addField(name)}
            options={[
              { value: "", label: t("app.ndv.parameters.types.collection.selectField") },
              ...availableToAdd.map((c) => ({ value: c.name, label: c.label })),
            ]}
            disabled={disabled}
            aria-label={t("app.ndv.parameters.types.collection.addField")}
            data-testid={`param-collection-add-field-${index}`}
          />
        </div>
      )}

      <div className="gc-param-collection__row-actions">
        <Button
          variant="ghost"
          size="xsmall"
          onClick={onRemove}
          disabled={disabled}
          data-testid={`param-collection-remove-${index}`}
        >
          {t("app.ndv.parameters.types.collection.removeRow")}
        </Button>
      </div>
    </div>
  );
}

export function ParameterCollection({
  value,
  onChange,
  children,
  min,
  max,
  disabled = false,
}: ParameterCollectionProps) {
  const { t } = useTranslation();

  const addRow = useCallback(() => {
    onChange([...value, fieldDefaultsForRow(children)]);
  }, [value, onChange, children]);

  const removeRow = useCallback(
    (idx: number) => {
      onChange(value.filter((_, i) => i !== idx));
    },
    [value, onChange],
  );

  const updateRow = useCallback(
    (idx: number, next: Record<string, unknown>) => {
      const copy = value.slice();
      copy[idx] = next;
      onChange(copy);
    },
    [value, onChange],
  );

  const canAdd = max === undefined || value.length < max;

  return (
    <div
      className="gc-param-collection"
      data-testid="param-collection"
    >
      <div className="gc-param-collection__rows">
        {value.map((row, idx) => (
          <RowEditor
            key={idx}
            index={idx}
            row={row}
            children={children}
            onChange={(next) => updateRow(idx, next)}
            onRemove={() => removeRow(idx)}
            disabled={disabled || (min !== undefined && value.length <= min)}
          />
        ))}
      </div>

      <div className="gc-param-collection__footer">
        <Button
          variant="ghost"
          size="small"
          iconLeft="plus"
          onClick={addRow}
          disabled={disabled || !canAdd}
          data-testid="param-collection-add-row"
        >
          {t("app.ndv.parameters.types.collection.addRow")}
        </Button>
      </div>
    </div>
  );
}

/* Local state hook for default-managed mode (unused but kept for future extension) */
export function useCollectionLocalState(initial: Array<Record<string, unknown>>) {
  return useState(initial);
}

export default ParameterCollection;

/* avoid unused React warning under strict TS */
void React;
