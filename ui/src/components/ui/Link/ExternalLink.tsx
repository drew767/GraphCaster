// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Icon } from "../Icon/Icon";
import { Link, type LinkProps } from "./Link";

export type ExternalLinkProps = Omit<
  LinkProps,
  "target" | "rel"
>;

export const ExternalLink = React.forwardRef<
  HTMLAnchorElement,
  ExternalLinkProps
>(({ children, ...rest }, ref) => {
  return (
    <Link
      ref={ref}
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
    >
      {children}
      <span className="gc-link__external-icon" aria-hidden="true">
        <Icon name="external-link" size={12} />
      </span>
    </Link>
  );
});

ExternalLink.displayName = "ExternalLink";
