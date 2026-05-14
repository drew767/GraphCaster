// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { Slot } from "@radix-ui/react-slot";

import { Icon, type IconName } from "../Icon/Icon";
import "./Button.css";

export type ButtonVariant =
  | "solid"
  | "subtle"
  | "ghost"
  | "outline"
  | "destructive"
  | "success"
  | "primary"
  | "secondary"
  | "tertiary"
  | "danger";

export type ButtonSize =
  | "xmini"
  | "mini"
  | "xsmall"
  | "small"
  | "medium"
  | "large"
  | "xlarge";

export interface ButtonProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "type" | "size"
  > {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: IconName;
  iconRight?: IconName;
  iconSize?: number;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
  asChild?: boolean;
  "aria-label"?: string;
}

function iconPxForSize(size: ButtonSize): number {
  switch (size) {
    case "xmini":
    case "mini":
    case "xsmall":
      return 12;
    case "small":
      return 14;
    case "medium":
      return 14;
    case "large":
      return 16;
    case "xlarge":
      return 18;
  }
}

const Spinner = () => (
  <svg
    className="btn__spinner"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <circle
      cx="8"
      cy="8"
      r="6"
      stroke="currentColor"
      strokeOpacity="0.25"
      strokeWidth="2"
    />
    <path
      d="M14 8a6 6 0 0 0-6-6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "solid",
      size = "medium",
      loading = false,
      iconLeft,
      iconRight,
      iconSize,
      fullWidth = false,
      type = "button",
      asChild = false,
      children,
      disabled,
      className,
      onClick,
      ...rest
    },
    ref,
  ) => {
    const resolvedIconSize = iconSize ?? iconPxForSize(size);
    const isDisabled = disabled || loading;

    const classes = [
      "btn",
      `btn--${variant}`,
      `btn--${size}`,
      fullWidth ? "btn--full-width" : "",
      loading ? "btn--loading" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    const content = (
      <>
        {loading ? (
          <span className="btn__spinner-wrap">
            <Spinner />
          </span>
        ) : (
          <>
            {iconLeft && (
              <Icon name={iconLeft} size={resolvedIconSize} />
            )}
          </>
        )}
        {!loading && (
          <span className="btn__inner">
            {!loading && iconLeft && null /* already rendered above */}
            {children}
          </span>
        )}
        {loading && (
          <span className="btn__inner btn__inner--hidden">{children}</span>
        )}
        {!loading && iconRight && (
          <Icon name={iconRight} size={resolvedIconSize} />
        )}
      </>
    );

    if (asChild) {
      return (
        <Slot
          ref={ref}
          className={classes}
          data-variant={variant}
          data-size={size}
          data-loading={loading || undefined}
          aria-busy={loading || undefined}
          aria-disabled={isDisabled || undefined}
          {...rest}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        aria-live="polite"
        className={classes}
        data-variant={variant}
        data-size={size}
        data-loading={loading || undefined}
        onClick={isDisabled ? undefined : onClick}
        {...rest}
      >
        {loading && (
          <span className="btn__spinner-wrap">
            <Spinner />
          </span>
        )}
        <span className="btn__inner" aria-hidden={loading || undefined}>
          {!loading && iconLeft && (
            <Icon name={iconLeft} size={resolvedIconSize} />
          )}
          {children}
          {!loading && iconRight && (
            <Icon name={iconRight} size={resolvedIconSize} />
          )}
        </span>
      </button>
    );
  },
);

Button.displayName = "Button";
