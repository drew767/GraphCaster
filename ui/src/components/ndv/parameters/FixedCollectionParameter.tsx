// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../../ui/Button/Button";
import { Accordion } from "../../ui/Accordion/Accordion";
import type { AccordionItem } from "../../ui/Accordion/Accordion";
import { Input } from "../../ui/Input/Input";
import { InputNumber } from "../../ui/InputNumber/InputNumber";
import { Select } from "../../ui/Select/Select";
import { Switch } from "../../ui/Switch/Switch";
import type { CollectionItemSchema } from "./CollectionParameter";
import "./FixedCollectionParameter.css";

export interface FixedCollectionSection {
  name: string;
  displayName: string;
  description?: string;
  fields: CollectionItemSchema[];
  defaultValue?: Record<string, unknown>;
}

export interface FixedCollectionParameterProps {
  value: Record<string, unknown>;
  onChange: (newValue: Record<string, unknown>) => void;
  sections: FixedCollectionSection[];
  disabled?: boolean;
}

interface SectionFieldProps {
  field: CollectionItemSchema;
  value: unknown;
  onChange: (val: unknown) => void;
  disabled?: boolean;
  fieldId: string;
}

function SectionField({ field, value, onChange, disabled, fieldId }: SectionFieldProps) {
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
          data-testid={`fixed-collection-field-${field.name}`}
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
          data-testid={`fixed-collection-field-${field.name}`}
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
          data-testid={`fixed-collection-field-${field.name}`}
        />
      );

    case "json":
      return (
        <textarea
          id={fieldId}
          className="gc-fixed-collection-json-field"
          value={typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={field.displayName}
          data-testid={`fixed-collection-field-${field.name}`}
          rows={3}
          placeholder={t("app.ndv.fixedCollection.jsonPlaceholder")}
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
          data-testid={`fixed-collection-field-${field.name}`}
        />
      );
  }
}

interface SectionContentProps {
  section: FixedCollectionSection;
  sectionValue: Record<string, unknown>;
  onFieldChange: (fieldName: string, val: unknown) => void;
  onRemove: () => void;
  disabled?: boolean;
  baseId: string;
}

function SectionContent({
  section,
  sectionValue,
  onFieldChange,
  onRemove,
  disabled,
  baseId,
}: SectionContentProps) {
  const { t } = useTranslation();

  return (
    <div className="gc-fixed-collection-section-content">
      {section.description && (
        <p className="gc-fixed-collection-section-desc">{section.description}</p>
      )}
      <div className="gc-fixed-collection-fields">
        {section.fields.map((field) => {
          const fieldId = `${baseId}-${field.name}`;
          return (
            <div key={field.name} className="gc-fixed-collection-field-row">
              {field.type !== "boolean" && (
                <label className="gc-fixed-collection-field-label" htmlFor={fieldId}>
                  {field.displayName}
                  {field.required && (
                    <span className="gc-fixed-collection-field-required" aria-hidden="true">
                      {" *"}
                    </span>
                  )}
                </label>
              )}
              <SectionField
                field={field}
                value={sectionValue[field.name] ?? field.default}
                onChange={(val) => onFieldChange(field.name, val)}
                disabled={disabled}
                fieldId={fieldId}
              />
            </div>
          );
        })}
      </div>
      <div className="gc-fixed-collection-section-footer">
        <Button
          variant="ghost"
          size="xsmall"
          iconLeft="trash-2"
          onClick={onRemove}
          disabled={disabled}
          data-testid={`fixed-collection-remove-${section.name}`}
        >
          {t("app.ndv.fixedCollection.remove")}
        </Button>
      </div>
    </div>
  );
}

export function FixedCollectionParameter({
  value,
  onChange,
  sections,
  disabled = false,
}: FixedCollectionParameterProps) {
  const { t } = useTranslation();
  const baseId = useId();

  const addSection = useCallback(
    (section: FixedCollectionSection) => {
      const defaults: Record<string, unknown> = { ...(section.defaultValue ?? {}) };
      for (const field of section.fields) {
        if (!(field.name in defaults) && field.default !== undefined) {
          defaults[field.name] = field.default;
        }
      }
      onChange({ ...value, [section.name]: defaults });
    },
    [value, onChange],
  );

  const removeSection = useCallback(
    (sectionName: string) => {
      const next = { ...value };
      delete next[sectionName];
      onChange(next);
    },
    [value, onChange],
  );

  const updateField = useCallback(
    (sectionName: string, fieldName: string, val: unknown) => {
      const sectionVal = (value[sectionName] as Record<string, unknown>) ?? {};
      onChange({ ...value, [sectionName]: { ...sectionVal, [fieldName]: val } });
    },
    [value, onChange],
  );

  const activeSections = sections.filter((s) => s.name in value);
  const inactiveSections = sections.filter((s) => !(s.name in value));

  const accordionItems: AccordionItem[] = activeSections.map((section) => ({
    id: section.name,
    title: section.displayName,
    content: (
      <SectionContent
        section={section}
        sectionValue={(value[section.name] as Record<string, unknown>) ?? {}}
        onFieldChange={(fieldName, val) => updateField(section.name, fieldName, val)}
        onRemove={() => removeSection(section.name)}
        disabled={disabled}
        baseId={`${baseId}-${section.name}`}
      />
    ),
  }));

  return (
    <div className="gc-fixed-collection-parameter" data-testid="fixed-collection-parameter">
      {accordionItems.length > 0 && (
        <Accordion
          type="multiple"
          items={accordionItems}
          defaultValue={activeSections.map((s) => s.name)}
          className="gc-fixed-collection-accordion"
        />
      )}

      {inactiveSections.length > 0 && (
        <div className="gc-fixed-collection-add-sections">
          {inactiveSections.map((section) => (
            <Button
              key={section.name}
              variant="ghost"
              size="small"
              iconLeft="plus"
              onClick={() => addSection(section)}
              disabled={disabled}
              data-testid={`fixed-collection-add-${section.name}`}
            >
              {t("app.ndv.fixedCollection.add", { name: section.displayName })}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
