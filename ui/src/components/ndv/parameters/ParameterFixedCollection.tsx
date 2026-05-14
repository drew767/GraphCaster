// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Accordion } from "../../ui/Accordion/Accordion";
import type { AccordionItem } from "../../ui/Accordion/Accordion";
import { Button } from "../../ui/Button/Button";
import { Input } from "../../ui/Input/Input";
import { InputNumber } from "../../ui/InputNumber/InputNumber";
import { Select } from "../../ui/Select/Select";
import { Switch } from "../../ui/Switch/Switch";
import "./ParameterTypes.css";

export interface FixedCollectionChildField {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  options?: Array<{ value: string; label: string }>;
  defaultValue?: unknown;
}

export interface FixedCollectionSectionDef {
  name: string;
  displayName: string;
  children: FixedCollectionChildField[];
  multiple?: boolean;
}

export type FixedCollectionInstance = Record<string, unknown>;

export type FixedCollectionValue = Record<
  string,
  FixedCollectionInstance | FixedCollectionInstance[]
>;

export interface ParameterFixedCollectionProps {
  value: FixedCollectionValue;
  onChange: (value: FixedCollectionValue) => void;
  sections: FixedCollectionSectionDef[];
  disabled?: boolean;
}

function defaultsFor(children: FixedCollectionChildField[]): FixedCollectionInstance {
  const out: FixedCollectionInstance = {};
  for (const c of children) {
    if (c.defaultValue !== undefined) out[c.name] = c.defaultValue;
  }
  return out;
}

interface FieldEditorProps {
  child: FixedCollectionChildField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  testIdPrefix: string;
}

function FieldEditor({
  child,
  value,
  onChange,
  disabled,
  testIdPrefix,
}: FieldEditorProps) {
  if (child.type === "number") {
    return (
      <InputNumber
        value={typeof value === "number" ? value : undefined}
        onChange={(n) => onChange(n ?? 0)}
        disabled={disabled}
        aria-label={child.label}
        data-testid={`${testIdPrefix}-${child.name}`}
      />
    );
  }
  if (child.type === "boolean") {
    return (
      <Switch
        checked={typeof value === "boolean" ? value : false}
        onCheckedChange={(b) => onChange(b)}
        disabled={disabled}
        label={child.label}
        data-testid={`${testIdPrefix}-${child.name}`}
      />
    );
  }
  if (child.type === "select") {
    return (
      <Select
        value={typeof value === "string" ? value : ""}
        onValueChange={(s) => onChange(s)}
        options={child.options ?? []}
        disabled={disabled}
        aria-label={child.label}
        data-testid={`${testIdPrefix}-${child.name}`}
      />
    );
  }
  return (
    <Input
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={child.label}
      data-testid={`${testIdPrefix}-${child.name}`}
    />
  );
}

interface InstanceEditorProps {
  section: FixedCollectionSectionDef;
  instance: FixedCollectionInstance;
  onChange: (next: FixedCollectionInstance) => void;
  onRemove?: () => void;
  disabled?: boolean;
  testIdPrefix: string;
}

function InstanceEditor({
  section,
  instance,
  onChange,
  onRemove,
  disabled,
  testIdPrefix,
}: InstanceEditorProps) {
  const { t } = useTranslation();
  return (
    <div className="gc-param-fixed-collection__instance" data-testid={testIdPrefix}>
      {section.children.map((child) => (
        <div
          key={child.name}
          className="gc-param-fixed-collection__field-row"
        >
          <label className="gc-param-fixed-collection__field-label">
            {child.label}
          </label>
          <FieldEditor
            child={child}
            value={instance[child.name]}
            onChange={(v) => onChange({ ...instance, [child.name]: v })}
            disabled={disabled}
            testIdPrefix={`${testIdPrefix}-field`}
          />
        </div>
      ))}
      {onRemove && (
        <div className="gc-param-fixed-collection__instance-actions">
          <Button
            variant="ghost"
            size="xsmall"
            onClick={onRemove}
            disabled={disabled}
            data-testid={`${testIdPrefix}-remove`}
          >
            {t("app.ndv.parameters.types.fixedCollection.removeInstance")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ParameterFixedCollection({
  value,
  onChange,
  sections,
  disabled = false,
}: ParameterFixedCollectionProps) {
  const { t } = useTranslation();

  const updateSection = useCallback(
    (sectionName: string, next: FixedCollectionInstance | FixedCollectionInstance[]) => {
      onChange({ ...value, [sectionName]: next });
    },
    [value, onChange],
  );

  const items: AccordionItem[] = useMemo(() => {
    return sections.map((section) => {
      const sectionValue = value[section.name];
      const isMultiple = section.multiple === true;

      const content = (
        <div className="gc-param-fixed-collection__section">
          {isMultiple ? (
            <>
              {(Array.isArray(sectionValue) ? sectionValue : []).map(
                (inst, idx) => (
                  <InstanceEditor
                    key={idx}
                    section={section}
                    instance={inst}
                    onChange={(next) => {
                      const arr = (Array.isArray(sectionValue)
                        ? sectionValue.slice()
                        : []) as FixedCollectionInstance[];
                      arr[idx] = next;
                      updateSection(section.name, arr);
                    }}
                    onRemove={() => {
                      const arr = (Array.isArray(sectionValue)
                        ? sectionValue.slice()
                        : []) as FixedCollectionInstance[];
                      arr.splice(idx, 1);
                      updateSection(section.name, arr);
                    }}
                    disabled={disabled}
                    testIdPrefix={`param-fixed-collection-${section.name}-${idx}`}
                  />
                ),
              )}
              <Button
                variant="ghost"
                size="small"
                iconLeft="plus"
                onClick={() => {
                  const arr = (Array.isArray(sectionValue)
                    ? sectionValue.slice()
                    : []) as FixedCollectionInstance[];
                  arr.push(defaultsFor(section.children));
                  updateSection(section.name, arr);
                }}
                disabled={disabled}
                data-testid={`param-fixed-collection-${section.name}-add`}
              >
                {t("app.ndv.parameters.types.fixedCollection.addInstance", {
                  name: section.displayName,
                })}
              </Button>
            </>
          ) : (
            <InstanceEditor
              section={section}
              instance={
                sectionValue && !Array.isArray(sectionValue)
                  ? (sectionValue as FixedCollectionInstance)
                  : defaultsFor(section.children)
              }
              onChange={(next) => updateSection(section.name, next)}
              disabled={disabled}
              testIdPrefix={`param-fixed-collection-${section.name}`}
            />
          )}
        </div>
      );

      return {
        id: section.name,
        title: section.displayName,
        content,
      };
    });
  }, [sections, value, updateSection, disabled, t]);

  return (
    <div
      className="gc-param-fixed-collection"
      data-testid="param-fixed-collection"
    >
      <Accordion
        type="multiple"
        items={items}
        defaultValue={sections.map((s) => s.name)}
      />
    </div>
  );
}

export default ParameterFixedCollection;
void React;
