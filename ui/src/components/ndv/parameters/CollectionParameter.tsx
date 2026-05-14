// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button/Button";
import { Checkbox } from "../../ui/Checkbox/Checkbox";
import { Collapsible } from "../../ui/Collapsible/Collapsible";
import { Input } from "../../ui/Input/Input";
import { InputNumber } from "../../ui/InputNumber/InputNumber";
import { Select } from "../../ui/Select/Select";
import { Switch } from "../../ui/Switch/Switch";
import "./CollectionParameter.css";

export interface CollectionItemSchema {
  name: string;
  displayName: string;
  type: "string" | "number" | "boolean" | "options" | "json";
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  default?: unknown;
}

export interface CollectionParameterProps {
  value: Array<Record<string, unknown>>;
  onChange: (newValue: Array<Record<string, unknown>>) => void;
  itemSchema: CollectionItemSchema[];
  addLabel?: string;
  emptyState?: React.ReactNode;
  maxItems?: number;
  itemDisplayName?: (item: Record<string, unknown>, index: number) => string;
  disabled?: boolean;
}

function resolveItemTitle(
  item: Record<string, unknown>,
  index: number,
  itemDisplayName?: (item: Record<string, unknown>, index: number) => string,
  fallbackLabel?: string,
): string {
  if (itemDisplayName) return itemDisplayName(item, index);
  return `${fallbackLabel ?? "Item"} ${index + 1}`;
}

interface ItemFieldProps {
  field: CollectionItemSchema;
  value: unknown;
  onChange: (val: unknown) => void;
  disabled?: boolean;
  fieldId: string;
}

function ItemField({ field, value, onChange, disabled, fieldId }: ItemFieldProps) {
  const { t } = useTranslation();

  switch (field.type) {
    case "number":
      return (
        <InputNumber
          id={fieldId}
          value={typeof value === "number" ? value : undefined}
          onChange={(v) => onChange(v)}
          disabled={disabled}
          aria-label={field.displayName}
          data-testid={`collection-field-${field.name}`}
        />
      );

    case "boolean":
      return (
        <Switch
          id={fieldId}
          checked={typeof value === "boolean" ? value : false}
          onCheckedChange={(v) => onChange(v)}
          disabled={disabled}
          label={field.displayName}
          data-testid={`collection-field-${field.name}`}
        />
      );

    case "options":
      return (
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => onChange(v)}
          options={field.options ?? []}
          disabled={disabled}
          aria-label={field.displayName}
          data-testid={`collection-field-${field.name}`}
        />
      );

    case "json":
      return (
        <textarea
          id={fieldId}
          className="gc-collection-json-field"
          value={typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={field.displayName}
          data-testid={`collection-field-${field.name}`}
          rows={3}
          placeholder={t("app.ndv.collection.jsonPlaceholder")}
        />
      );

    case "string":
    default:
      return (
        <Input
          id={fieldId}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={field.displayName}
          data-testid={`collection-field-${field.name}`}
        />
      );
  }
}

interface CollectionItemProps {
  item: Record<string, unknown>;
  index: number;
  schema: CollectionItemSchema[];
  title: string;
  onChange: (index: number, updated: Record<string, unknown>) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

function CollectionItem({
  item,
  index,
  schema,
  title,
  onChange,
  onRemove,
  disabled,
}: CollectionItemProps) {
  const { t } = useTranslation();
  const baseId = useId();

  const handleFieldChange = useCallback(
    (fieldName: string, val: unknown) => {
      onChange(index, { ...item, [fieldName]: val });
    },
    [index, item, onChange],
  );

  const trigger = (
    <span className="gc-collection-item-header">
      <span className="gc-collection-item-title">{title}</span>
      <button
        type="button"
        className="gc-collection-item-remove"
        aria-label={t("app.ndv.collection.removeItem")}
        disabled={disabled}
        data-testid={`collection-remove-${index}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(index);
        }}
      >
        ×
      </button>
    </span>
  );

  return (
    <div className="gc-collection-item" data-testid={`collection-item-${index}`}>
      <Collapsible trigger={trigger} defaultOpen={true}>
        <div className="gc-collection-item-fields">
          {schema.map((field) => {
            const fieldId = `${baseId}-${field.name}`;
            return (
              <div key={field.name} className="gc-collection-field-row">
                {field.type !== "boolean" && (
                  <label className="gc-collection-field-label" htmlFor={fieldId}>
                    {field.displayName}
                    {field.required && (
                      <span className="gc-collection-field-required" aria-hidden="true">
                        {" *"}
                      </span>
                    )}
                  </label>
                )}
                <ItemField
                  field={field}
                  value={item[field.name] ?? field.default}
                  onChange={(val) => handleFieldChange(field.name, val)}
                  disabled={disabled}
                  fieldId={fieldId}
                />
              </div>
            );
          })}
        </div>
      </Collapsible>
    </div>
  );
}

export function CollectionParameter({
  value,
  onChange,
  itemSchema,
  addLabel,
  emptyState,
  maxItems,
  itemDisplayName,
  disabled = false,
}: CollectionParameterProps) {
  const { t } = useTranslation();

  const addItem = useCallback(() => {
    const defaults: Record<string, unknown> = {};
    for (const field of itemSchema) {
      if (field.default !== undefined) {
        defaults[field.name] = field.default;
      }
    }
    onChange([...value, defaults]);
  }, [value, onChange, itemSchema]);

  const removeItem = useCallback(
    (index: number) => {
      onChange(value.filter((_, i) => i !== index));
    },
    [value, onChange],
  );

  const updateItem = useCallback(
    (index: number, updated: Record<string, unknown>) => {
      const next = [...value];
      next[index] = updated;
      onChange(next);
    },
    [value, onChange],
  );

  const isMaxReached = maxItems !== undefined && value.length >= maxItems;

  return (
    <div className="gc-collection-parameter" data-testid="collection-parameter">
      {value.length === 0 && emptyState ? (
        <div className="gc-collection-empty">{emptyState}</div>
      ) : (
        <div className="gc-collection-items">
          {value.map((item, index) => (
            <CollectionItem
              key={index}
              item={item}
              index={index}
              schema={itemSchema}
              title={resolveItemTitle(item, index, itemDisplayName, t("app.ndv.collection.item"))}
              onChange={updateItem}
              onRemove={removeItem}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      <div className="gc-collection-footer">
        <Button
          variant="ghost"
          size="small"
          iconLeft="plus"
          onClick={addItem}
          disabled={disabled || isMaxReached}
          data-testid="collection-add-button"
        >
          {addLabel ?? t("app.ndv.collection.addItem")}
        </Button>
      </div>
    </div>
  );
}
