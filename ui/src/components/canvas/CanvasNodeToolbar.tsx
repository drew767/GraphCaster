// Copyright GraphCaster. All Rights Reserved.
// UX72 — Floating toolbar above/beside a node on hover/select.

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../ui/Icon/Icon";
import { Tooltip } from "../ui/Tooltip/Tooltip";
import "./CanvasNodeToolbar.css";

export interface CanvasNodeToolbarProps {
  nodeId: string;
  nodeType: string;
  isMuted: boolean;
  selected: boolean;
  /** Screen-space rect of the node — toolbar positions itself above it. */
  nodeRect: { top: number; left: number; width: number };
  onRunNode: (nodeId: string) => void;
  onToggleDisable: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onChangeColor?: (nodeId: string) => void;
  structureLocked?: boolean;
}

function CanvasNodeToolbarInner({
  nodeId,
  nodeType,
  isMuted,
  selected,
  nodeRect,
  onRunNode,
  onToggleDisable,
  onDelete,
  onChangeColor,
  structureLocked = false,
}: CanvasNodeToolbarProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [nodeHovered, setNodeHovered] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const isVisible = selected || nodeHovered || hovered;
  const isColorNode = nodeType === "comment" || nodeType === "group";

  const handleRunNode = useCallback(() => {
    onRunNode(nodeId);
  }, [onRunNode, nodeId]);

  const handleToggleDisable = useCallback(() => {
    onToggleDisable(nodeId);
  }, [onToggleDisable, nodeId]);

  const handleDelete = useCallback(() => {
    onDelete(nodeId);
  }, [onDelete, nodeId]);

  const handleChangeColor = useCallback(() => {
    onChangeColor?.(nodeId);
  }, [onChangeColor, nodeId]);

  const style: React.CSSProperties = {
    top: nodeRect.top - 44,
    left: nodeRect.left + nodeRect.width / 2,
    transform: "translateX(-50%)",
  };

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t("app.canvas.nodeToolbar.label")}
      className={`gc-node-toolbar${isVisible ? " gc-node-toolbar--visible" : ""}`}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid="node-toolbar"
      data-node-id={nodeId}
    >
      <Tooltip content={t("app.canvas.nodeToolbar.runNode")} side="top" delayDuration={300}>
        <button
          type="button"
          className="gc-node-toolbar__btn"
          onClick={handleRunNode}
          aria-label={t("app.canvas.nodeToolbar.runNode")}
          disabled={structureLocked}
        >
          <Icon name="circle-play" size={16} />
        </button>
      </Tooltip>

      <Tooltip
        content={isMuted ? t("app.canvas.nodeToolbar.enableNode") : t("app.canvas.nodeToolbar.disableNode")}
        side="top"
        delayDuration={300}
      >
        <button
          type="button"
          className={`gc-node-toolbar__btn${isMuted ? " gc-node-toolbar__btn--active" : ""}`}
          onClick={handleToggleDisable}
          aria-label={isMuted ? t("app.canvas.nodeToolbar.enableNode") : t("app.canvas.nodeToolbar.disableNode")}
          aria-pressed={isMuted}
          disabled={structureLocked}
        >
          <Icon name="power" size={16} />
        </button>
      </Tooltip>

      {isColorNode && (
        <Tooltip content={t("app.canvas.nodeToolbar.changeColor")} side="top" delayDuration={300}>
          <button
            type="button"
            className="gc-node-toolbar__btn"
            onClick={handleChangeColor}
            aria-label={t("app.canvas.nodeToolbar.changeColor")}
            disabled={structureLocked}
          >
            <Icon name="contrast" size={16} />
          </button>
        </Tooltip>
      )}

      <span className="gc-node-toolbar__divider" aria-hidden="true" />

      <Tooltip content={t("app.canvas.nodeToolbar.deleteNode")} side="top" delayDuration={300}>
        <button
          type="button"
          className="gc-node-toolbar__btn gc-node-toolbar__btn--danger"
          onClick={handleDelete}
          aria-label={t("app.canvas.nodeToolbar.deleteNode")}
          disabled={structureLocked}
        >
          <Icon name="trash-2" size={16} />
        </button>
      </Tooltip>
    </div>
  );
}

export const CanvasNodeToolbar = memo(CanvasNodeToolbarInner);
CanvasNodeToolbar.displayName = "CanvasNodeToolbar";
