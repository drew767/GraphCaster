// Copyright GraphCaster. All Rights Reserved.

import { useReactFlow, useStore } from "@xyflow/react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../ui/Icon/Icon";
import { KeyboardShortcut } from "../ui/KeyboardShortcut/KeyboardShortcut";
import { Tooltip } from "../ui/Tooltip/Tooltip";

type CanvasControlButtonsProps = {
  /** Called when the user triggers auto-layout (delegates to existing UX76/F76 button logic). */
  onAutoLayout?: () => void;
  /** When true, disable auto-layout (e.g. during a run). */
  structureLocked?: boolean;
};

function ControlBtn({
  label,
  shortcut,
  icon,
  onClick,
  disabled,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  label: string;
  shortcut?: string | string[];
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const tooltipContent = shortcut ? (
    <span className="gc-canvas-ctrl-tooltip">
      {label}
      {" "}
      <KeyboardShortcut keys={shortcut} size="xsmall" />
    </span>
  ) : (
    label
  );

  return (
    <Tooltip content={tooltipContent} side="right">
      <button
        type="button"
        className="gc-canvas-ctrl__btn"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        data-testid={testId}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

/**
 * UX78 — Canvas control button strip (bottom-left of the canvas viewport).
 *
 * Vertical stack: fit view (1), zoom in (+), zoom out (-), reset zoom (0, only when zoom != 1),
 * auto-layout (Shift+Alt+T), toggle zoom mode (Z, placeholder).
 *
 * Positioned via CSS as a React Flow panel overlay — not subject to canvas zoom transform.
 */
export function CanvasControlButtons({
  onAutoLayout,
  structureLocked = false,
}: CanvasControlButtonsProps) {
  const { t } = useTranslation();
  const { fitView, zoomIn, zoomOut, zoomTo } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const showResetZoom = Math.abs(zoom - 1) > 0.005;

  const handleFitView = useCallback(() => {
    void fitView({ padding: 0.15, duration: 200 });
  }, [fitView]);

  const handleZoomIn = useCallback(() => {
    void zoomIn({ duration: 150 });
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    void zoomOut({ duration: 150 });
  }, [zoomOut]);

  const handleResetZoom = useCallback(() => {
    void zoomTo(1, { duration: 200 });
  }, [zoomTo]);

  return (
    <div className="gc-canvas-ctrl" data-testid="canvas-control-buttons">
      <ControlBtn
        label={t("app.canvas.controls.fitView")}
        shortcut="1"
        icon={<Icon name="expand" size={16} />}
        onClick={handleFitView}
        data-testid="canvas-ctrl-fit"
      />
      <ControlBtn
        label={t("app.canvas.controls.zoomIn")}
        shortcut="+"
        icon={<Icon name="zoom-in" size={16} />}
        onClick={handleZoomIn}
        data-testid="canvas-ctrl-zoom-in"
      />
      <ControlBtn
        label={t("app.canvas.controls.zoomOut")}
        shortcut="-"
        icon={<Icon name="zoom-out" size={16} />}
        onClick={handleZoomOut}
        data-testid="canvas-ctrl-zoom-out"
      />
      {showResetZoom && (
        <ControlBtn
          label={t("app.canvas.controls.resetZoom")}
          shortcut="0"
          icon={<Icon name="maximize-2" size={16} />}
          onClick={handleResetZoom}
          data-testid="canvas-ctrl-reset-zoom"
        />
      )}
      <ControlBtn
        label={t("app.canvas.controls.autoLayout")}
        shortcut={["Shift", "Alt", "T"]}
        icon={<Icon name="layout-template" size={16} />}
        onClick={() => onAutoLayout?.()}
        disabled={structureLocked || onAutoLayout === undefined}
        data-testid="canvas-ctrl-auto-layout"
      />
      <ControlBtn
        label={t("app.canvas.controls.toggleZoomMode")}
        shortcut="Z"
        icon={<Icon name="crosshair" size={16} />}
        onClick={() => {}}
        data-testid="canvas-ctrl-zoom-mode"
      />
    </div>
  );
}
