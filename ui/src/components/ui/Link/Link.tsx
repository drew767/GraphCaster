// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import "./Link.css";

export interface LinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "color"> {
  variant?: "default" | "subtle" | "danger";
  underline?: "always" | "hover" | "none";
  children?: React.ReactNode;
}

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  (
    {
      variant = "default",
      underline = "hover",
      children,
      className,
      ...rest
    },
    ref
  ) => {
    const classes = [
      "gc-link",
      `gc-link--${variant}`,
      `gc-link--underline-${underline}`,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <a ref={ref} className={classes} {...rest}>
        {children}
      </a>
    );
  }
);

Link.displayName = "Link";
