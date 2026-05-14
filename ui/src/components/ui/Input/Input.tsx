// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Icon } from "../Icon/Icon";
import type { IconName } from "../Icon/registry";
import "./Input.css";

export type InputSize = "xsmall" | "small" | "medium" | "large";
export type InputVariant = "default" | "error" | "success";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: InputSize;
  variant?: InputVariant;
  iconLeft?: IconName;
  iconRight?: IconName;
  clearable?: boolean;
  type?: "text" | "email" | "password" | "url" | "search" | "tel" | "date" | "datetime-local" | "time" | "number";
  onClear?: () => void;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      size = "medium",
      variant = "default",
      iconLeft,
      iconRight,
      clearable = false,
      type = "text",
      className,
      onClear,
      value,
      onChange,
      ...rest
    },
    ref,
  ) => {
    const showClear = clearable && value !== undefined && value !== "";
    const showRightIcon = iconRight && !showClear;

    const inputClasses = [
      "gc-input",
      `gc-input--${size}`,
      variant !== "default" ? `gc-input--${variant}` : "",
      iconLeft ? "gc-input--has-icon-left" : "",
      showRightIcon ? "gc-input--has-icon-right" : "",
      showClear ? "gc-input--has-clear" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className="gc-input-field-wrap">
        {iconLeft && (
          <span className="gc-input-icon gc-input-icon--left">
            <Icon name={iconLeft} size={14} />
          </span>
        )}
        <input
          ref={ref}
          type={type}
          className={inputClasses}
          value={value}
          onChange={onChange}
          {...rest}
        />
        {showRightIcon && (
          <span className="gc-input-icon gc-input-icon--right">
            <Icon name={iconRight} size={14} />
          </span>
        )}
        {showClear && (
          <button
            type="button"
            className="gc-input-clear"
            aria-label="Clear"
            tabIndex={-1}
            onClick={onClear}
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
