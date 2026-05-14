// Copyright GraphCaster. All Rights Reserved.

import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useEditorUiStore } from "../app/stores/editorUiStore";
import { Icon } from "../components/ui/Icon/Icon";
import { DropdownMenu } from "../components/ui/DropdownMenu/DropdownMenu";
import { Tooltip } from "../components/ui/Tooltip/Tooltip";
import { tidyUp, type TidyUpDirection } from "./layout/dagre";
import "./CanvasControlsPanel.css";

export interface CanvasControlsPanelProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAddSticky: () => void;
}

type IconBtnProps = {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  testId: string;
};

function IconBtn({ label, icon, onClick, pressed, disabled, testId }: IconBtnProps) {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        className="gc-canvas-controls__btn"
        aria-label={label}
        aria-pressed={pressed}
        data-pressed={pressed ? "true" : undefined}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

export function CanvasControlsPanel({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddSticky,
}: CanvasControlsPanelProps) {
  const { t } = useTranslation();
  const { fitView, zoomIn, zoomOut, getNodes, getEdges, setNodes } = useReactFlow();

  const snapToGrid = useEditorUiStore((s) => s.snapToGrid);
  const canvasLocked = useEditorUiStore((s) => s.canvasLocked);
  const toggleSnapToGrid = useEditorUiStore((s) => s.toggleSnapToGrid);
  const toggleCanvasLocked = useEditorUiStore((s) => s.toggleCanvasLocked);

  const handleFitView = useCallback(() => {
    void fitView({ padding: 0.15, duration: 200 });
  }, [fitView]);

  const handleZoomIn = useCallback(() => {
    void zoomIn({ duration: 150 });
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    void zoomOut({ duration: 150 });
  }, [zoomOut]);

  const runTidyUp = useCallback(
    async (direction: TidyUpDirection) => {
      const nodes = getNodes();
      const edges = getEdges();
      const next = await tidyUp(nodes, edges, direction);
      setNodes(next);
      window.requestAnimationFrame(() => {
        void fitView({ padding: 0.15, duration: 200 });
      });
    },
    [getNodes, getEdges, setNodes, fitView],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k !== "f") {
        return;
      }
      e.preventDefault();
      void runTidyUp("LR");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [runTidyUp]);

  return (
    <div
      className="gc-canvas-controls"
      data-testid="canvas-controls-panel"
      role="toolbar"
      aria-label={t("app.canvas.controls.panel")}
    >
      <IconBtn
        label={t("app.canvas.controls.fitView")}
        icon={<Icon name="expand" size={16} />}
        onClick={handleFitView}
        testId="canvas-controls-fit"
      />
      <IconBtn
        label={t("app.canvas.controls.zoomIn")}
        icon={<Icon name="plus" size={16} />}
        onClick={handleZoomIn}
        testId="canvas-controls-zoom-in"
      />
      <IconBtn
        label={t("app.canvas.controls.zoomOut")}
        icon={<Icon name="minus" size={16} />}
        onClick={handleZoomOut}
        testId="canvas-controls-zoom-out"
      />
      <IconBtn
        label={
          canvasLocked
            ? t("app.canvas.controls.unlock")
            : t("app.canvas.controls.lock")
        }
        icon={<Icon name="lock" size={16} />}
        onClick={toggleCanvasLocked}
        pressed={canvasLocked}
        testId="canvas-controls-lock"
      />
      <IconBtn
        label={t("app.canvas.controls.undoShortcut", "Undo (Ctrl+Z)")}
        icon={<Icon name="undo-2" size={16} />}
        onClick={onUndo}
        disabled={!canUndo}
        testId="canvas-controls-undo"
      />
      <IconBtn
        label={t("app.canvas.controls.redoShortcut", "Redo (Ctrl+Shift+Z)")}
        icon={<Icon name="redo-2" size={16} />}
        onClick={onRedo}
        disabled={!canRedo}
        testId="canvas-controls-redo"
      />
      <IconBtn
        label={
          snapToGrid
            ? t("app.canvas.controls.snapOff")
            : t("app.canvas.controls.snapOn")
        }
        icon={<Icon name="hash" size={16} />}
        onClick={toggleSnapToGrid}
        pressed={snapToGrid}
        testId="canvas-controls-snap"
      />
      <IconBtn
        label={t("app.canvas.controls.addSticky")}
        icon={<Icon name="sticky-note" size={16} />}
        onClick={onAddSticky}
        testId="canvas-controls-sticky"
      />
      <DropdownMenu
        side="right"
        align="end"
        trigger={
          <button
            type="button"
            className="gc-canvas-controls__btn"
            aria-label={t("app.canvas.controls.layout")}
            data-testid="canvas-controls-layout"
          >
            <Icon name="ellipsis" size={16} />
          </button>
        }
        items={[
          {
            id: "tidy-lr",
            label: t("app.canvas.controls.tidyLR"),
            onSelect: () => {
              void runTidyUp("LR");
            },
          },
          {
            id: "tidy-tb",
            label: t("app.canvas.controls.tidyTB"),
            onSelect: () => {
              void runTidyUp("TB");
            },
          },
        ]}
      />
    </div>
  );
}
