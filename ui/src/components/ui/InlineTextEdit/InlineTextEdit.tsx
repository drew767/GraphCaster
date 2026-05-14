// Copyright GraphCaster. All Rights Reserved.

import React, { useRef, useState, useCallback } from "react";

import { Icon } from "../Icon/Icon";
import type { IconName } from "../Icon/registry";
import "./InlineTextEdit.css";

export interface InlineTextEditProps {
  value: string;
  onChange: (newValue: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  maxLength?: number;
  size?: "small" | "medium" | "large";
  disabled?: boolean;
  selectOnFocus?: boolean;
  commitOn?: "enter" | "blur" | "both";
  validate?: (value: string) => string | undefined;
  className?: string;
  inputClassName?: string;
  icon?: IconName;
  endAdornment?: React.ReactNode;
}

export function InlineTextEdit({
  value,
  onChange,
  onCancel,
  placeholder,
  maxLength,
  size = "medium",
  disabled = false,
  selectOnFocus = true,
  commitOn = "both",
  validate,
  className,
  inputClassName,
  icon,
  endAdornment,
}: InlineTextEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(() => {
    if (disabled) return;
    setDraft(value);
    setError(undefined);
    setEditing(true);
  }, [disabled, value]);

  const tryCommit = useCallback(
    (currentDraft: string) => {
      const err = validate?.(currentDraft);
      if (err) {
        setError(err);
        return false;
      }
      setError(undefined);
      setEditing(false);
      onChange(currentDraft);
      return true;
    },
    [validate, onChange],
  );

  const revert = useCallback(() => {
    setError(undefined);
    setEditing(false);
    setDraft(value);
    onCancel?.();
  }, [value, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (commitOn === "blur") {
          revert();
        } else {
          tryCommit(draft);
        }
      } else if (e.key === "Escape") {
        revert();
      }
    },
    [commitOn, draft, tryCommit, revert],
  );

  const handleBlur = useCallback(() => {
    if (commitOn === "enter") {
      revert();
    } else {
      tryCommit(draft);
    }
  }, [commitOn, draft, tryCommit, revert]);

  const handleFocus = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      if (selectOnFocus) {
        e.target.select();
      }
    },
    [selectOnFocus],
  );

  const rootClasses = [
    "gc-ite",
    `gc-ite--${size}`,
    disabled ? "gc-ite--disabled" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  if (editing) {
    const inputClasses = [
      "gc-ite__input",
      `gc-ite__input--${size}`,
      error ? "gc-ite__input--error" : "",
      inputClassName ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={rootClasses}>
        {icon && (
          <span className="gc-ite__icon" aria-hidden="true">
            <Icon name={icon} size={iconSizeForSize(size)} />
          </span>
        )}
        <input
          ref={inputRef}
          autoFocus
          className={inputClasses}
          value={draft}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(validate?.(e.target.value));
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={handleFocus}
        />
        {endAdornment && (
          <span className="gc-ite__end-adornment">{endAdornment}</span>
        )}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={rootClasses}
      onClick={startEditing}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") startEditing();
      }}
      aria-disabled={disabled || undefined}
    >
      {icon && (
        <span className="gc-ite__icon" aria-hidden="true">
          <Icon name={icon} size={iconSizeForSize(size)} />
        </span>
      )}
      <span className="gc-ite__display">
        {value || (
          <span className="gc-ite__placeholder">{placeholder}</span>
        )}
      </span>
      {endAdornment && (
        <span className="gc-ite__end-adornment">{endAdornment}</span>
      )}
    </div>
  );
}

function iconSizeForSize(size: "small" | "medium" | "large"): number {
  switch (size) {
    case "small": return 12;
    case "medium": return 14;
    case "large": return 16;
  }
}
