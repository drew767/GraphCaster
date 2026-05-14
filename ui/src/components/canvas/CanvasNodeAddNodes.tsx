// Copyright GraphCaster. All Rights Reserved.
// UX73 — Big "+" button for empty canvas.

import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Tooltip } from "../ui/Tooltip/Tooltip";
import "./CanvasNodeAddNodes.css";

export interface CanvasNodeAddNodesProps {
  onOpen: () => void;
}

function CanvasNodeAddNodesInner({ onOpen }: CanvasNodeAddNodesProps) {
  const { t } = useTranslation();

  const handleClick = useCallback(() => {
    onOpen();
  }, [onOpen]);

  return (
    <div className="gc-canvas-add-nodes" aria-label={t("app.canvas.addNodes.panelLabel")}>
      <Tooltip
        content={t("app.canvas.addNodes.tooltip")}
        side="bottom"
        delayDuration={700}
      >
        <button
          type="button"
          className="gc-canvas-add-nodes__btn"
          onClick={handleClick}
          aria-label={t("app.canvas.addNodes.buttonLabel")}
          data-testid="canvas-add-nodes-btn"
        >
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="gc-canvas-add-nodes__icon"
          >
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </Tooltip>
      <span className="gc-canvas-add-nodes__label" aria-hidden="true">
        {t("app.canvas.addNodes.firstStep")}
      </span>
    </div>
  );
}

export const CanvasNodeAddNodes = memo(CanvasNodeAddNodesInner);
CanvasNodeAddNodes.displayName = "CanvasNodeAddNodes";
