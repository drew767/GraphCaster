// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RxCollapsible from "@radix-ui/react-collapsible";

import { Icon } from "../Icon/Icon";
import "./Collapsible.css";

export interface CollapsibleProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
  triggerSide?: "leading" | "trailing";
  className?: string;
}

export const Collapsible = React.forwardRef<HTMLDivElement, CollapsibleProps>(
  (
    {
      open,
      defaultOpen,
      onOpenChange,
      trigger,
      children,
      triggerSide = "leading",
      className,
    },
    ref,
  ) => {
    return (
      <RxCollapsible.Root
        ref={ref}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        className={["gc-collapsible", className].filter(Boolean).join(" ")}
      >
        <RxCollapsible.Trigger asChild>
          <button
            className={[
              "gc-collapsible__trigger",
              `gc-collapsible__trigger--${triggerSide}`,
            ].join(" ")}
            aria-label={typeof trigger === "string" ? trigger : undefined}
          >
            {triggerSide === "leading" && (
              <span className="gc-collapsible__chevron" aria-hidden="true">
                <Icon name="chevron-right" size={14} />
              </span>
            )}
            <span className="gc-collapsible__trigger-label">{trigger}</span>
            {triggerSide === "trailing" && (
              <span className="gc-collapsible__chevron" aria-hidden="true">
                <Icon name="chevron-right" size={14} />
              </span>
            )}
          </button>
        </RxCollapsible.Trigger>

        <RxCollapsible.Content className="gc-collapsible__content">
          {children}
        </RxCollapsible.Content>
      </RxCollapsible.Root>
    );
  },
);

Collapsible.displayName = "Collapsible";
