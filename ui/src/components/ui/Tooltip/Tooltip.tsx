// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RxTooltip from "@radix-ui/react-tooltip";

import "./Tooltip.css";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  delayDuration = 200,
  open,
  defaultOpen,
  onOpenChange,
  disabled = false,
}: TooltipProps) {
  if (disabled) {
    return children;
  }

  return (
    <RxTooltip.Provider delayDuration={delayDuration}>
      <RxTooltip.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        delayDuration={delayDuration}
      >
        <RxTooltip.Trigger asChild>{children}</RxTooltip.Trigger>
        <RxTooltip.Portal>
          <RxTooltip.Content
            side={side}
            align={align}
            className="gc-tooltip-content"
            sideOffset={6}
          >
            {content}
            <RxTooltip.Arrow className="gc-tooltip-arrow" />
          </RxTooltip.Content>
        </RxTooltip.Portal>
      </RxTooltip.Root>
    </RxTooltip.Provider>
  );
}

export { RxTooltip as TooltipPrimitive };

export function TooltipProvider({
  children,
  delayDuration = 200,
}: {
  children: React.ReactNode;
  delayDuration?: number;
}) {
  return (
    <RxTooltip.Provider delayDuration={delayDuration}>
      {children}
    </RxTooltip.Provider>
  );
}
