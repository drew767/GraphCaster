// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";
import * as RxSelect from "@radix-ui/react-select";

import { Icon } from "../Icon/Icon";
import type { IconName } from "../Icon/registry";
import type { InputSize, InputVariant } from "../Input/Input";
import "./Select.css";

export interface SelectOption<T = string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
}

export interface SelectProps<T = string> {
  value?: T;
  onValueChange?: (value: T) => void;
  options: Array<SelectOption<T>>;
  placeholder?: string;
  size?: InputSize;
  variant?: InputVariant;
  searchable?: boolean;
  /** @todo multi not yet supported */
  multi?: boolean;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}

function SelectInner<T extends string>(
  {
    value,
    onValueChange,
    options,
    placeholder = "Select an option",
    size = "medium",
    variant = "default",
    searchable = false,
    multi = false,
    disabled = false,
    id,
    "aria-label": ariaLabel,
    "data-testid": testId,
  }: SelectProps<T>,
  ref: React.ForwardedRef<HTMLButtonElement>,
) {
  const { t } = useTranslation();

  if (multi) {
    console.error("[Select] multi is not yet supported (TODO)");
  }

  const [search, setSearch] = React.useState("");

  const filteredOptions = searchable
    ? options.filter((o) =>
        o.label.toLowerCase().includes(search.toLowerCase()),
      )
    : options;

  const selectedLabel = options.find((o) => o.value === value)?.label;

  const triggerClasses = [
    "gc-select-trigger",
    `gc-select-trigger--${size}`,
    variant !== "default" ? `gc-select-trigger--${variant}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <RxSelect.Root
      value={value}
      onValueChange={onValueChange as (v: string) => void}
      disabled={disabled}
    >
      <RxSelect.Trigger
        ref={ref}
        id={id}
        className={triggerClasses}
        aria-label={ariaLabel}
        data-testid={testId}
      >
        <span className="gc-select-trigger-value">
          {value && selectedLabel ? (
            selectedLabel
          ) : (
            <span className="gc-select-placeholder">{placeholder}</span>
          )}
        </span>
        <RxSelect.Icon asChild>
          <span className="gc-select-trigger-icon">
            <Icon name="chevrons-up-down" size={14} />
          </span>
        </RxSelect.Icon>
      </RxSelect.Trigger>

      <RxSelect.Portal>
        <RxSelect.Content className="gc-select-content" position="popper">
          <RxSelect.ScrollUpButton className="gc-select-scroll-btn">
            <Icon name="chevron-up" size={12} />
          </RxSelect.ScrollUpButton>

          {searchable && (
            <div className="gc-select-search-wrap">
              <input
                className="gc-select-search"
                placeholder={t("app.ui.select.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label={t("app.ui.select.searchAria")}
              />
            </div>
          )}

          <RxSelect.Viewport className="gc-select-viewport">
            {filteredOptions.length === 0 ? (
              <div className="gc-select-empty">{t("app.ui.select.noOptions")}</div>
            ) : (
              filteredOptions.map((opt) => (
                <RxSelect.Item
                  key={String(opt.value)}
                  value={String(opt.value)}
                  disabled={opt.disabled}
                  className="gc-select-item"
                >
                  {opt.icon && <Icon name={opt.icon} size={14} />}
                  <RxSelect.ItemText>
                    <span className="gc-select-item-label">{opt.label}</span>
                  </RxSelect.ItemText>
                </RxSelect.Item>
              ))
            )}
          </RxSelect.Viewport>

          <RxSelect.ScrollDownButton className="gc-select-scroll-btn">
            <Icon name="chevron-down" size={12} />
          </RxSelect.ScrollDownButton>
        </RxSelect.Content>
      </RxSelect.Portal>
    </RxSelect.Root>
  );
}

export const Select = React.forwardRef(SelectInner) as <T extends string>(
  props: SelectProps<T> & { ref?: React.ForwardedRef<HTMLButtonElement> },
) => React.ReactElement;

(Select as unknown as { displayName: string }).displayName = "Select";
