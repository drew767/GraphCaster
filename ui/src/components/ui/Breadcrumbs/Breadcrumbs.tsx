// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Icon, type IconName } from "../Icon/Icon";
import "./Breadcrumbs.css";

export interface BreadcrumbItem {
  label: React.ReactNode;
  href?: string;
  onClick?: () => void;
  icon?: IconName;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  separator?: React.ReactNode;
  maxItems?: number;
  className?: string;
}

function DefaultSeparator() {
  return <Icon name="chevron-right" size={14} />;
}

export function Breadcrumbs({
  items,
  separator,
  maxItems,
  className,
}: BreadcrumbsProps) {
  const sep = separator !== undefined ? separator : <DefaultSeparator />;

  let visible: (BreadcrumbItem | null)[] = items;

  if (maxItems !== undefined && items.length > maxItems) {
    const keepStart = Math.ceil((maxItems - 1) / 2);
    const keepEnd = Math.floor((maxItems - 1) / 2);
    visible = [
      ...items.slice(0, keepStart),
      null,
      ...items.slice(items.length - keepEnd),
    ];
  }

  const classes = ["gc-breadcrumbs", className].filter(Boolean).join(" ");

  return (
    <nav aria-label="Breadcrumb">
      <ol className={classes}>
        {visible.map((item, index) => {
          const isLast =
            index === visible.length - 1;
          const showSeparator = index < visible.length - 1;

          if (item === null) {
            return (
              <li key={`ellipsis-${index}`} className="gc-breadcrumbs__item">
                <span className="gc-breadcrumbs__ellipsis" aria-hidden="true">
                  &hellip;
                </span>
                {showSeparator && (
                  <span className="gc-breadcrumbs__separator" aria-hidden="true">
                    {sep}
                  </span>
                )}
              </li>
            );
          }

          return (
            <li key={index} className="gc-breadcrumbs__item">
              {isLast ? (
                <span className="gc-breadcrumbs__current" aria-current="page">
                  {item.icon && <Icon name={item.icon} size={14} />}
                  {item.label}
                </span>
              ) : item.href ? (
                <a
                  className="gc-breadcrumbs__link"
                  href={item.href}
                  onClick={item.onClick}
                >
                  {item.icon && <Icon name={item.icon} size={14} />}
                  {item.label}
                </a>
              ) : (
                <button
                  type="button"
                  className="gc-breadcrumbs__link"
                  onClick={item.onClick}
                >
                  {item.icon && <Icon name={item.icon} size={14} />}
                  {item.label}
                </button>
              )}
              {showSeparator && (
                <span className="gc-breadcrumbs__separator" aria-hidden="true">
                  {sep}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
