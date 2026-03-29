// Copyright Aura. All Rights Reserved.

import { useCallback } from "react";
import {
  GC_DRAG_NODE_MIME_TYPE,
  encodeNodeDragData,
  type NodeDragPayload,
} from "../graph/nodeDragDrop";

export interface DraggableNodeItemProps {
  nodeType: string;
  label: string;
  payload: NodeDragPayload;
  onClick?: () => void;
}

export function DraggableNodeItem({
  nodeType,
  label,
  payload,
  onClick,
}: DraggableNodeItemProps) {
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLLIElement>) => {
      const dt = e.dataTransfer;
      dt.setData(GC_DRAG_NODE_MIME_TYPE, encodeNodeDragData(payload));
      dt.effectAllowed = "copy";
    },
    [payload],
  );

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
      draggable
      tabIndex={0}
      aria-label={`${label}. Drag to canvas or press Enter to add.`}
      onDragStart={handleDragStart}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <span className="gc-draggable-node-item__type">{nodeType}</span>
      <span className="gc-draggable-node-item__label">{label}</span>
    </li>
  );
}
