// Copyright Aura. All Rights Reserved.

import { useCallback, useRef } from "react";
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
  nodeType: _nodeType,
  label,
  payload,
  onClick,
}: DraggableNodeItemProps) {
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLLIElement>) => {
      const dt = e.dataTransfer;
      dt.setData(GC_DRAG_NODE_MIME_TYPE, encodeNodeDragData(payload));
      dt.effectAllowed = "copy";

      // Create custom drag ghost
      const ghost = document.createElement("div");
      ghost.className = "gc-drag-ghost";
      ghost.textContent = label;
      ghost.style.position = "absolute";
      ghost.style.top = "-9999px";
      ghost.style.left = "-9999px";
      document.body.appendChild(ghost);
      ghostRef.current = ghost;
      dt.setDragImage(ghost, 12, 12);
    },
    [payload, label],
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
      draggable
      tabIndex={0}
      aria-label={`${label}. Drag to canvas or press Enter to add.`}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {label}
    </li>
  );
}
