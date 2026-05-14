// Copyright Aura. All Rights Reserved.

import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  GC_DRAG_NODE_MIME_TYPE,
  encodeNodeDragData,
  type NodeDragPayload,
} from "../graph/nodeDragDrop";
import type { NodeCategoryColorId } from "../graph/nodeCategoryColors";
import "./DraggableNodeItem.css";

export interface DraggableNodeItemProps {
  nodeType: string;
  label: string;
  icon?: string;
  category?: NodeCategoryColorId;
  payload: NodeDragPayload;
  onClick?: () => void;
}

export function DraggableNodeItem({
  nodeType: _nodeType,
  label,
  icon,
  category = "default",
  payload,
  onClick,
}: DraggableNodeItemProps) {
  const { t } = useTranslation();
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLLIElement>) => {
      const dt = e.dataTransfer;
      dt.setData(GC_DRAG_NODE_MIME_TYPE, encodeNodeDragData(payload));
      dt.effectAllowed = "copy";

      // Create custom drag ghost with icon
      const ghost = document.createElement("div");
      ghost.className = "gc-drag-ghost";
      ghost.textContent = icon ? `${icon} ${label}` : label;
      ghost.style.position = "absolute";
      ghost.style.top = "-9999px";
      ghost.style.left = "-9999px";
      document.body.appendChild(ghost);
      ghostRef.current = ghost;
      dt.setDragImage(ghost, 12, 12);
    },
    [payload, label, icon],
  );

  const handleDragEnd = useCallback(() => {
    if (ghostRef.current) {
      document.body.removeChild(ghostRef.current);
      ghostRef.current = null;
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLLIElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick?.();
      }
    },
    [onClick],
  );

  return (
    <li
      role="listitem"
      className="gc-draggable-node-item"
      data-category={category}
      draggable
      tabIndex={0}
      aria-label={`${label}. ${t("app.canvas.nodeItemDragHint")}`}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {icon && <span className="gc-draggable-node-item__icon">{icon}</span>}
      <span className="gc-draggable-node-item__label">{label}</span>
      <span className="gc-draggable-node-item__grip" aria-hidden="true">⋮⋮</span>
    </li>
  );
}
