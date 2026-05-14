// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RxRadioGroup from "@radix-ui/react-radio-group";

import "./RadioGroup.css";

export type RadioSize = "small" | "medium";

export interface RadioOption<T = string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface RadioGroupProps<T = string> {
  value?: T;
  onValueChange?: (value: T) => void;
  options: Array<RadioOption<T>>;
  orientation?: "horizontal" | "vertical";
  size?: RadioSize;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}

function RadioGroupInner<T extends string>(
  {
    value,
    onValueChange,
    options,
    orientation = "vertical",
    size = "medium",
    disabled = false,
    id,
    "aria-label": ariaLabel,
    "data-testid": testId,
  }: RadioGroupProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  return (
    <RxRadioGroup.Root
      ref={ref}
      id={id}
      value={value}
      onValueChange={onValueChange as (v: string) => void}
      disabled={disabled}
      orientation={orientation}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`gc-radio-group gc-radio-group--${orientation}`}
    >
      {options.map((opt) => {
        const itemId = `${id ?? "radio"}-${String(opt.value)}`;
        return (
          <div
            key={String(opt.value)}
            className="gc-radio-item"
            data-disabled={opt.disabled || disabled || undefined}
          >
            <RxRadioGroup.Item
              id={itemId}
              value={String(opt.value)}
              disabled={opt.disabled}
              className={`gc-radio-btn gc-radio-btn--${size}`}
              aria-label={opt.label}
            >
              <RxRadioGroup.Indicator className="gc-radio-indicator">
                <span className="gc-radio-dot" />
              </RxRadioGroup.Indicator>
            </RxRadioGroup.Item>

            {(opt.label || opt.description) && (
              <div className="gc-radio-labels">
                {opt.label && (
                  <label htmlFor={itemId} className="gc-radio-label">
                    {opt.label}
                  </label>
                )}
                {opt.description && (
                  <span className="gc-radio-description">
                    {opt.description}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </RxRadioGroup.Root>
  );
}

export const RadioGroup = React.forwardRef(RadioGroupInner) as <
  T extends string,
>(
  props: RadioGroupProps<T> & { ref?: React.ForwardedRef<HTMLDivElement> },
) => React.ReactElement;

(RadioGroup as unknown as { displayName: string }).displayName = "RadioGroup";
