// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RxMenu from "@radix-ui/react-dropdown-menu";

import { Icon, type IconName } from "../Icon/Icon";
import "./DropdownMenu.css";

export interface DropdownItem {
  id: string;
  label?: React.ReactNode;
  icon?: IconName;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** Nested submenu items */
  children?: DropdownItem[];
  /** Render a separator above this item (or standalone when label is absent) */
  separator?: boolean;
  /** Render a group label above items */
  groupLabel?: string;
}

export interface DropdownMenuProps {
  trigger: React.ReactElement;
  items: DropdownItem[];
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ItemContent({
  item,
}: {
  item: DropdownItem;
}) {
  return (
    <>
      {item.icon && (
        <span className="gc-dropdown-item-icon" aria-hidden>
          <Icon name={item.icon} size={14} />
        </span>
      )}
      <span className="gc-dropdown-item-label">{item.label}</span>
      {item.shortcut && (
        <span className="gc-dropdown-item-shortcut">{item.shortcut}</span>
      )}
    </>
  );
}

function renderItems(items: DropdownItem[]): React.ReactNode {
  const nodes: React.ReactNode[] = [];

  items.forEach((item) => {
    // Standalone separator (no label)
    if (item.separator && !item.label) {
      nodes.push(
        <RxMenu.Separator
          key={`sep-${item.id}`}
          className="gc-dropdown-separator"
        />
      );
      return;
    }

    // Group label (header above a set of items)
    if (item.groupLabel) {
      nodes.push(
        <RxMenu.Label key={`label-${item.id}`} className="gc-dropdown-group-label">
          {item.groupLabel}
        </RxMenu.Label>
      );
      return;
    }

    // Separator before item (item also has a label)
    if (item.separator) {
      nodes.push(
        <RxMenu.Separator
          key={`sep-before-${item.id}`}
          className="gc-dropdown-separator"
        />
      );
    }

    // Sub-menu
    if (item.children && item.children.length > 0) {
      nodes.push(
        <RxMenu.Sub key={item.id}>
          <RxMenu.SubTrigger
            disabled={item.disabled}
            className={[
              "gc-dropdown-item",
              "gc-dropdown-subtrigger",
              item.destructive ? "gc-dropdown-item--destructive" : "",
              item.disabled ? "gc-dropdown-item--disabled" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <ItemContent item={item} />
            <span className="gc-dropdown-item-chevron" aria-hidden>
              <Icon name="chevron-right" size={12} />
            </span>
          </RxMenu.SubTrigger>
          <RxMenu.Portal>
            <RxMenu.SubContent className="gc-dropdown-content" sideOffset={2} alignOffset={-4}>
              {renderItems(item.children)}
            </RxMenu.SubContent>
          </RxMenu.Portal>
        </RxMenu.Sub>
      );
      return;
    }

    // Regular item
    nodes.push(
      <RxMenu.Item
        key={item.id}
        disabled={item.disabled}
        onSelect={() => item.onSelect?.()}
        className={[
          "gc-dropdown-item",
          item.destructive ? "gc-dropdown-item--destructive" : "",
          item.disabled ? "gc-dropdown-item--disabled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <ItemContent item={item} />
      </RxMenu.Item>
    );
  });

  return nodes;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DropdownMenu({
  trigger,
  items,
  side = "bottom",
  align = "start",
  open,
  defaultOpen,
  onOpenChange,
}: DropdownMenuProps) {
  return (
    <RxMenu.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      <RxMenu.Trigger asChild>{trigger}</RxMenu.Trigger>
      <RxMenu.Portal>
        <RxMenu.Content
          side={side}
          align={align}
          sideOffset={6}
          className="gc-dropdown-content"
        >
          {renderItems(items)}
        </RxMenu.Content>
      </RxMenu.Portal>
    </RxMenu.Root>
  );
}
