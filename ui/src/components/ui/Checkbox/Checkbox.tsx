// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RxCheckbox from "@radix-ui/react-checkbox";

import { Icon } from "../Icon/Icon";
import "./Checkbox.css";

export type CheckboxSize = "small" | "medium" | "large";

export interface CheckboxProps {
  checked?: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: CheckboxSize;
  id?: string;
  "data-testid"?: string;
}

const ICON_SIZE: Record<CheckboxSize, number> = {
  small: 10,
  medium: 12,
  large: 14,
};

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  (
    {
      checked,
      onCheckedChange,
      label,
      description,
      disabled = false,
      size = "medium",
      id,
      "data-testid": testId,
    },
    ref,
  ) => {
    const checkboxId = id ?? React.useId();

    return (
      <div className="gc-checkbox-root" data-disabled={disabled || undefined}>
        <RxCheckbox.Root
          ref={ref}
          id={checkboxId}
          className={`gc-checkbox-box gc-checkbox-box--${size}`}
          checked={checked}
          onCheckedChange={(val) => {
            if (typeof val === "boolean") {
              onCheckedChange?.(val);
            }
          }}
          disabled={disabled}
          data-testid={testId}
          aria-label={label ?? undefined}
        >
          <RxCheckbox.Indicator className="gc-checkbox-indicator">
            {checked === "indeterminate" ? (
              <Icon name="minus" size={ICON_SIZE[size]} />
            ) : (
              <Icon name="check" size={ICON_SIZE[size]} />
            )}
          </RxCheckbox.Indicator>
        </RxCheckbox.Root>

        {(label || description) && (
          <div className="gc-checkbox-labels">
            {label && (
              <label htmlFor={checkboxId} className="gc-checkbox-label">
                {label}
              </label>
            )}
            {description && (
              <span className="gc-checkbox-description">{description}</span>
            )}
          </div>
        )}
      </div>
    );
  },
);

Checkbox.displayName = "Checkbox";
