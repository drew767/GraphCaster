// Copyright GraphCaster. All Rights Reserved.

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  ResourceLocator,
  type ResourceLocatorProps,
  type ResourceLocatorValue,
} from "./ResourceLocator/ResourceLocator";
import {
  ResourceLocatorInput,
  type ResourceLocatorInputSchema,
  type ResourceLocatorInputValue,
} from "./ResourceLocatorInput";
import { CollectionParameter } from "./CollectionParameter";
import type { CollectionItemSchema } from "./CollectionParameter";
import { FixedCollectionParameter } from "./FixedCollectionParameter";
import type { FixedCollectionSection } from "./FixedCollectionParameter";
import {
  ParameterCollection,
  type CollectionChildField,
} from "./ParameterCollection";
import {
  ParameterFixedCollection,
  type FixedCollectionSectionDef,
  type FixedCollectionValue,
} from "./ParameterFixedCollection";
import {
  MultiOptionsInput,
  type MultiOptionsOption,
} from "./MultiOptionsInput";
import { DateTimeInput } from "./DateTimeInput";
import {
  FilterRuleBuilder,
  DEFAULT_FILTER_VALUE,
  type FilterGroup,
} from "./FilterRuleBuilder";
import {
  AssignmentCollection,
  type Assignment,
} from "./AssignmentCollection";
import { Popover } from "../../ui/Popover/Popover";
import { Button } from "../../ui/Button/Button";
import { InfoTip } from "../../ui/InfoTip/InfoTip";
import { FormError } from "./FormError";
import { isVisible, type ParameterDisplayOptions } from "./visibility";
import {
  useFieldValidation,
  type FieldValidationSchema,
} from "./useFieldValidation";

/* ── Parameter field descriptor ─────────────────────────────────── */

export type ParameterFieldType =
  | "string"
  | "number"
  | "boolean"
  | "resourceLocator"
  | "options"
  | "collection"
  | "fixedCollection"
  | "multiOptions"
  | "dateTime"
  | "filter"
  | "assignmentCollection";

export interface ParameterFieldHelp {
  description?: string;
  docsUrl?: string;
  example?: string;
}

export interface ParameterField extends FieldValidationSchema {
  name: string;
  type: ParameterFieldType;
  label: string;
  defaultValue?: unknown;
  help?: ParameterFieldHelp;
  /** Short tooltip description for the inline (?) info icon. */
  description?: string;
  /** Optional link to detailed docs, appended to the description tooltip. */
  docsUrl?: string;
  /** Conditional display rules. */
  displayOptions?: ParameterDisplayOptions;
  /** Only relevant when type === "resourceLocator" */
  resourceLocator?: Omit<ResourceLocatorProps, "value" | "onChange">;
  /** Alternative schema-driven simple resource locator (UXP33). */
  resourceLocatorInput?: ResourceLocatorInputSchema;
  /** Legacy: relevant for the older CollectionParameter widget. */
  itemSchema?: CollectionItemSchema[];
  /** Legacy: relevant for the older CollectionParameter widget. */
  addLabel?: string;
  /** Legacy: relevant for the older CollectionParameter widget. */
  maxItems?: number;
  /** Legacy: relevant for the older CollectionParameter widget. */
  itemDisplayName?: (item: Record<string, unknown>, index: number) => string;
  /** Legacy: relevant for the older FixedCollectionParameter widget. */
  sections?: FixedCollectionSection[];

  /** type === "collection": list of child fields. */
  childrenFields?: CollectionChildField[];
  /** type === "collection": minimum number of rows. */
  minRows?: number;
  /** type === "collection": maximum number of rows. */
  maxRows?: number;

  /** type === "fixedCollection": section definitions. */
  fixedSections?: FixedCollectionSectionDef[];

  /** type === "multiOptions": available options. */
  multiOptions?: MultiOptionsOption[];

  /** type === "dateTime": show inline "Now" button (default: true). */
  showNowButton?: boolean;

  /** type === "filter": maximum nesting depth (default 1). */
  filterMaxDepth?: number;
}

interface HelpPopoverProps {
  help: ParameterFieldHelp;
  fieldName: string;
}

function HelpPopover({ help, fieldName }: HelpPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      side="right"
      align="start"
      width={300}
      trigger={
        <Button
          variant="ghost"
          size="xsmall"
          aria-label={t("app.help.openDocs")}
          data-testid={`help-trigger-${fieldName}`}
          className="gc-param-help-btn"
          type="button"
        >
          &#9432;
        </Button>
      }
    >
      {open && (
        <div className="gc-param-help-popover" data-testid={`help-content-${fieldName}`}>
          {help.description && (
            <p className="gc-param-help-popover__desc">{help.description}</p>
          )}
          {help.example && (
            <div className="gc-param-help-popover__example">
              <span className="gc-param-help-popover__example-label">
                {t("app.help.example")}:
              </span>
              <code className="gc-param-help-popover__example-code">{help.example}</code>
            </div>
          )}
          {help.docsUrl && (
            <a
              href={help.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="gc-param-help-popover__link"
              data-testid={`help-docs-link-${fieldName}`}
            >
              {t("app.help.learnMore")} &rarr;
            </a>
          )}
        </div>
      )}
    </Popover>
  );
}

export interface ParameterInputListProps {
  fields: ParameterField[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  disabled?: boolean;
}

/* ── DescriptionTip ─────────────────────────────────────────────── */

function DescriptionTip({
  description,
  docsUrl,
  fieldName,
}: {
  description: string;
  docsUrl?: string;
  fieldName: string;
}) {
  const { t } = useTranslation();
  return (
    <span data-testid={`description-tip-${fieldName}`}>
      <InfoTip>
        <div className="gc-param-description-tip">
          {description.split("\n").map((line, idx) => (
            <div key={idx} className="gc-param-description-tip__line">
              {line}
            </div>
          ))}
          {docsUrl && (
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="gc-param-description-tip__link"
              data-testid={`description-tip-link-${fieldName}`}
            >
              {t("app.ndv.parameters.learnMore")} &rarr;
            </a>
          )}
        </div>
      </InfoTip>
    </span>
  );
}

/* ── ParameterRow ───────────────────────────────────────────────── */

interface ParameterRowProps {
  field: ParameterField;
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  disabled: boolean;
}

function ParameterRow({ field, values, onChange, disabled }: ParameterRowProps) {
  const value = values[field.name];
  const { error, onBlur, dirty } = useFieldValidation(value, {
    required: field.required,
    minLength: field.minLength,
    maxLength: field.maxLength,
    pattern: field.pattern,
  });

  const showError = dirty && !!error;
  const controlClass = [
    "gc-parameter-input-list__control",
    showError ? "gc-parameter-input-list__control--error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="gc-parameter-input-list__field"
      data-testid={`parameter-row-${field.name}`}
      onBlur={onBlur}
    >
      <div className="gc-parameter-input-list__label-row">
        <label
          className="gc-parameter-input-list__label"
          htmlFor={`param-${field.name}`}
        >
          {field.label}
        </label>
        {field.description && (
          <DescriptionTip
            description={field.description}
            docsUrl={field.docsUrl}
            fieldName={field.name}
          />
        )}
        {field.help && (
          <HelpPopover help={field.help} fieldName={field.name} />
        )}
      </div>

      <div className={controlClass}>
        {field.type === "resourceLocator" && field.resourceLocatorInput ? (
          <ResourceLocatorInput
            schema={field.resourceLocatorInput}
            value={
              (values[field.name] as ResourceLocatorInputValue) ?? {
                mode: field.resourceLocatorInput.defaultMode ??
                  field.resourceLocatorInput.modes?.[0] ?? "list",
                value: "",
              }
            }
            onChange={(v) => onChange(field.name, v)}
            disabled={disabled}
          />
        ) : field.type === "resourceLocator" && field.resourceLocator ? (
          <ResourceLocator
            {...field.resourceLocator}
            value={
              (values[field.name] as ResourceLocatorValue) ?? {
                mode: "id",
                value: "",
              }
            }
            onChange={(v) => onChange(field.name, v)}
            disabled={disabled || field.resourceLocator.disabled}
          />
        ) : field.type === "collection" && field.childrenFields ? (
          <ParameterCollection
            value={
              Array.isArray(values[field.name])
                ? (values[field.name] as Array<Record<string, unknown>>)
                : []
            }
            onChange={(v) => onChange(field.name, v)}
            children={field.childrenFields}
            min={field.minRows}
            max={field.maxRows}
            disabled={disabled}
          />
        ) : field.type === "collection" ? (
          <CollectionParameter
            value={
              Array.isArray(values[field.name])
                ? (values[field.name] as Array<Record<string, unknown>>)
                : []
            }
            onChange={(v) => onChange(field.name, v)}
            itemSchema={field.itemSchema ?? []}
            addLabel={field.addLabel}
            maxItems={field.maxItems}
            itemDisplayName={field.itemDisplayName}
            disabled={disabled}
          />
        ) : field.type === "fixedCollection" && field.fixedSections ? (
          <ParameterFixedCollection
            value={
              values[field.name] !== null &&
              typeof values[field.name] === "object" &&
              !Array.isArray(values[field.name])
                ? (values[field.name] as FixedCollectionValue)
                : ({} as FixedCollectionValue)
            }
            onChange={(v) => onChange(field.name, v)}
            sections={field.fixedSections}
            disabled={disabled}
          />
        ) : field.type === "fixedCollection" ? (
          <FixedCollectionParameter
            value={
              values[field.name] !== null &&
              typeof values[field.name] === "object" &&
              !Array.isArray(values[field.name])
                ? (values[field.name] as Record<string, unknown>)
                : {}
            }
            onChange={(v) => onChange(field.name, v)}
            sections={field.sections ?? []}
            disabled={disabled}
          />
        ) : field.type === "multiOptions" ? (
          <MultiOptionsInput
            value={
              Array.isArray(values[field.name])
                ? (values[field.name] as string[])
                : []
            }
            onChange={(v) => onChange(field.name, v)}
            options={field.multiOptions ?? []}
            disabled={disabled}
          />
        ) : field.type === "dateTime" ? (
          <DateTimeInput
            value={typeof values[field.name] === "string" ? (values[field.name] as string) : ""}
            onChange={(v) => onChange(field.name, v)}
            showNowButton={field.showNowButton !== false}
            disabled={disabled}
          />
        ) : field.type === "filter" ? (
          <FilterRuleBuilder
            value={
              values[field.name] && typeof values[field.name] === "object"
                ? (values[field.name] as FilterGroup)
                : DEFAULT_FILTER_VALUE
            }
            onChange={(v) => onChange(field.name, v)}
            maxDepth={field.filterMaxDepth ?? 1}
            disabled={disabled}
          />
        ) : field.type === "assignmentCollection" ? (
          <AssignmentCollection
            value={
              Array.isArray(values[field.name])
                ? (values[field.name] as Assignment[])
                : []
            }
            onChange={(v) => onChange(field.name, v)}
            disabled={disabled}
          />
        ) : (
          /* Placeholder rendering for other types */
          <div
            id={`param-${field.name}`}
            className="gc-parameter-input-list__placeholder"
            data-type={field.type}
          >
            {String(values[field.name] ?? field.defaultValue ?? "")}
          </div>
        )}
      </div>

      {showError && error && <FormError message={error} fieldName={field.name} />}
    </div>
  );
}

/* ── ParameterInputList ─────────────────────────────────────────── */

export function ParameterInputList({
  fields,
  values,
  onChange,
  disabled = false,
}: ParameterInputListProps) {
  return (
    <div className="gc-parameter-input-list">
      {fields
        .filter((field) => isVisible(field, values))
        .map((field) => (
          <ParameterRow
            key={field.name}
            field={field}
            values={values}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
    </div>
  );
}
