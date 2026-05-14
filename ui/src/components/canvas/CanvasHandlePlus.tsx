// Copyright GraphCaster. All Rights Reserved.
// UX73 — Animated "+" on unconnected output handles.

import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import "./CanvasHandlePlus.css";

export type HandlePlusSize = "small" | "medium" | "large";

export interface CanvasHandlePlusProps {
  sourceNodeId: string;
  sourceHandle: string;
  size?: HandlePlusSize;
  pulsing?: boolean;
  onOpen: (sourceNodeId: string, sourceHandle: string) => void;
}

function CanvasHandlePlusInner({
  sourceNodeId,
  sourceHandle,
  size = "medium",
  pulsing = false,
  onOpen,
}: CanvasHandlePlusProps) {
  const { t } = useTranslation();

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onOpen(sourceNodeId, sourceHandle);
    },
    [onOpen, sourceNodeId, sourceHandle],
  );

  return (
    <button
      type="button"
      className={
        `gc-handle-plus gc-handle-plus--${size}` +
        (pulsing ? " gc-handle-plus--pulsing" : "")
      }
      onClick={handleClick}
      aria-label={t("app.canvas.handlePlus.label")}
      title={t("app.canvas.handlePlus.label")}
      data-testid="handle-plus"
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="gc-handle-plus__icon"
      >
        <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export const CanvasHandlePlus = memo(CanvasHandlePlusInner);
CanvasHandlePlus.displayName = "CanvasHandlePlus";
