// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RxSwitch from "@radix-ui/react-switch";

import "./Switch.css";

export type SwitchSize = "small" | "medium" | "large";

export interface SwitchProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  size?: SwitchSize;
  id?: string;
  "data-testid"?: string;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
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
    const switchId = id ?? React.useId();

    return (
      <div
        className="gc-switch-root"
        data-disabled={disabled || undefined}
      >
        <RxSwitch.Root
          ref={ref}
          id={switchId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          data-testid={testId}
          aria-label={label ?? undefined}
          className={`gc-switch-track gc-switch-track--${size}`}
        >
          <RxSwitch.Thumb className="gc-switch-thumb" />
        </RxSwitch.Root>

        {(label || description) && (
          <div className="gc-switch-labels">
            {label && (
              <label htmlFor={switchId} className="gc-switch-label">
                {label}
              </label>
            )}
            {description && (
              <span className="gc-switch-description">{description}</span>
            )}
          </div>
        )}
      </div>
    );
  },
);

Switch.displayName = "Switch";
