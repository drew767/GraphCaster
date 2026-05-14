// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RxTabs from "@radix-ui/react-tabs";

import { Icon, type IconName } from "../Icon/Icon";
import "./Tabs.css";

export interface TabItem {
  id: string;
  label: React.ReactNode;
  icon?: IconName;
  badge?: React.ReactNode;
  disabled?: boolean;
  content: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  orientation?: "horizontal" | "vertical";
  variant?: "underline" | "pills";
  size?: "small" | "medium" | "large";
  fullWidth?: boolean;
  lazyMount?: boolean;
  className?: string;
}

export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  (
    {
      items,
      value,
      defaultValue,
      onValueChange,
      orientation = "horizontal",
      variant = "underline",
      size = "medium",
      fullWidth = false,
      lazyMount = false,
      className,
    },
    ref,
  ) => {
    const resolvedDefault = defaultValue ?? (value === undefined ? items[0]?.id : undefined);

    return (
      <RxTabs.Root
        ref={ref}
        value={value}
        defaultValue={resolvedDefault}
        onValueChange={onValueChange}
        orientation={orientation}
        className={[
          "gc-tabs",
          `gc-tabs--${orientation}`,
          `gc-tabs--${variant}`,
          `gc-tabs--${size}`,
          fullWidth ? "gc-tabs--full-width" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <RxTabs.List
          className="gc-tabs__list"
          aria-orientation={orientation}
        >
          {items.map((item) => (
            <RxTabs.Trigger
              key={item.id}
              value={item.id}
              disabled={item.disabled}
              className="gc-tabs__trigger"
            >
              {item.icon && (
                <span className="gc-tabs__trigger-icon" aria-hidden="true">
                  <Icon
                    name={item.icon}
                    size={size === "small" ? 12 : size === "large" ? 16 : 14}
                  />
                </span>
              )}
              <span className="gc-tabs__trigger-label">{item.label}</span>
              {item.badge !== undefined && (
                <span className="gc-tabs__trigger-badge">{item.badge}</span>
              )}
            </RxTabs.Trigger>
          ))}
        </RxTabs.List>

        {items.map((item) => {
          if (lazyMount) {
            return (
              <RxTabs.Content
                key={item.id}
                value={item.id}
                className="gc-tabs__content"
                forceMount={undefined}
              >
                {item.content}
              </RxTabs.Content>
            );
          }
          return (
            <RxTabs.Content
              key={item.id}
              value={item.id}
              className="gc-tabs__content"
            >
              {item.content}
            </RxTabs.Content>
          );
        })}
      </RxTabs.Root>
    );
  },
);

Tabs.displayName = "Tabs";
