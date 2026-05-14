// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RxPopover from "@radix-ui/react-popover";

import "./Popover.css";

export interface PopoverProps {
  trigger: React.ReactElement;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  width?: number | string;
}

export function Popover({
  trigger,
  children,
  side = "bottom",
  align = "center",
  open,
  defaultOpen,
  onOpenChange,
  modal = false,
  width,
}: PopoverProps) {
  const style: React.CSSProperties | undefined =
    width !== undefined
      ? { width: typeof width === "number" ? `${width}px` : width }
      : undefined;

  return (
    <RxPopover.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      modal={modal}
    >
      <RxPopover.Trigger asChild>{trigger}</RxPopover.Trigger>
      <RxPopover.Portal>
        <RxPopover.Content
          side={side}
          align={align}
          sideOffset={6}
          className="gc-popover-content"
          style={style}
        >
          {children}
          <RxPopover.Arrow className="gc-popover-arrow" />
        </RxPopover.Content>
      </RxPopover.Portal>
    </RxPopover.Root>
  );
}

export { RxPopover as PopoverPrimitive };
