// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RxScrollArea from "@radix-ui/react-scroll-area";

import "./ScrollArea.css";

export interface ScrollAreaProps {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string | number;
  scrollbarSize?: "thin" | "default" | "hidden";
  type?: "auto" | "always" | "scroll" | "hover";
  orientation?: "vertical" | "horizontal" | "both";
}

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  (
    {
      children,
      className,
      maxHeight,
      scrollbarSize = "default",
      type = "hover",
      orientation = "vertical",
    },
    ref,
  ) => {
    const maxHeightValue =
      maxHeight !== undefined
        ? typeof maxHeight === "number"
          ? `${maxHeight}px`
          : maxHeight
        : undefined;

    const rootClasses = [
      "gc-scroll-area",
      `gc-scroll-area--scrollbar-${scrollbarSize}`,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <RxScrollArea.Root
        ref={ref}
        className={rootClasses}
        type={type}
        style={maxHeightValue ? { maxHeight: maxHeightValue } : undefined}
      >
        <RxScrollArea.Viewport className="gc-scroll-area__viewport">
          {children}
        </RxScrollArea.Viewport>

        {(orientation === "vertical" || orientation === "both") && (
          <RxScrollArea.Scrollbar
            className="gc-scroll-area__scrollbar gc-scroll-area__scrollbar--vertical"
            orientation="vertical"
            data-size={scrollbarSize}
          >
            <RxScrollArea.Thumb className="gc-scroll-area__thumb" />
          </RxScrollArea.Scrollbar>
        )}

        {(orientation === "horizontal" || orientation === "both") && (
          <RxScrollArea.Scrollbar
            className="gc-scroll-area__scrollbar gc-scroll-area__scrollbar--horizontal"
            orientation="horizontal"
            data-size={scrollbarSize}
          >
            <RxScrollArea.Thumb className="gc-scroll-area__thumb" />
          </RxScrollArea.Scrollbar>
        )}

        <RxScrollArea.Corner className="gc-scroll-area__corner" />
      </RxScrollArea.Root>
    );
  },
);

ScrollArea.displayName = "ScrollArea";
