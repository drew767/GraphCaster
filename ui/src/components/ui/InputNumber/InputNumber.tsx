// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Icon } from "../Icon/Icon";
import type { InputSize, InputVariant } from "../Input/Input";
import "./InputNumber.css";

export interface InputNumberProps {
  value?: number;
  onChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: InputSize;
  variant?: InputVariant;
  disabled?: boolean;
  showButtons?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}

export const InputNumber = React.forwardRef<
  HTMLInputElement,
  InputNumberProps
>(
  (
    {
      value,
      onChange,
      min,
      max,
      step = 1,
      size = "medium",
      variant = "default",
      disabled = false,
      showButtons = true,
      placeholder,
      id,
      name,
      "aria-label": ariaLabel,
      "data-testid": testId,
    },
    ref,
  ) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === "" || raw === "-") {
        onChange?.(null);
        return;
      }
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) {
        onChange?.(parsed);
      }
    };

    const clamp = (v: number): number => {
      let result = v;
      if (min !== undefined) result = Math.max(min, result);
      if (max !== undefined) result = Math.min(max, result);
      return result;
    };

    const handleStep = (direction: 1 | -1) => {
      const current = value ?? 0;
      onChange?.(clamp(current + direction * (step ?? 1)));
    };

    const canIncrement = !disabled && (max === undefined || (value ?? 0) < max);
    const canDecrement = !disabled && (min === undefined || (value ?? 0) > min);

    const inputClasses = [
      "gc-input-number",
      `gc-input-number--${size}`,
      variant !== "default" ? `gc-input-number--${variant}` : "",
      showButtons ? "gc-input-number--with-buttons" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className="gc-input-number-wrap">
        <input
          ref={ref}
          id={id}
          name={name}
          type="number"
          className={inputClasses}
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel}
          data-testid={testId}
          onChange={handleChange}
        />
        {showButtons && (
          <div className="gc-input-number-steppers">
            <button
              type="button"
              className="gc-input-number-step"
              aria-label="Increment"
              disabled={!canIncrement}
              tabIndex={-1}
              onClick={() => handleStep(1)}
            >
              <Icon name="chevron-up" size={10} />
            </button>
            <button
              type="button"
              className="gc-input-number-step"
              aria-label="Decrement"
              disabled={!canDecrement}
              tabIndex={-1}
              onClick={() => handleStep(-1)}
            >
              <Icon name="chevron-down" size={10} />
            </button>
          </div>
        )}
      </div>
    );
  },
);

InputNumber.displayName = "InputNumber";
