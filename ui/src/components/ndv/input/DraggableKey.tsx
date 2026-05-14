// Copyright GraphCaster. All Rights Reserved.

import type { DragEvent, ReactNode } from "react";

export const MAPPING_MIME = "application/x-gc-mapping";

export interface DraggableKeyPayload {
  path: string;
  sourceNodeName: string;
}

export interface DraggableKeyProps {
  path: string;
  sourceNodeName: string;
  children: ReactNode;
  className?: string;
}

export function DraggableKey({
  path,
  sourceNodeName,
  children,
  className,
}: DraggableKeyProps) {
  function handleDragStart(event: DragEvent<HTMLSpanElement>) {
    const payload: DraggableKeyPayload = { path, sourceNodeName };
    event.dataTransfer.setData(MAPPING_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  }

  const classes = ["gc-draggable-key", className].filter(Boolean).join(" ");

  return (
    <span
      className={classes}
      draggable
      onDragStart={handleDragStart}
      data-testid={`draggable-key-${path}`}
      data-path={path}
      data-source-node={sourceNodeName}
    >
      {children}
    </span>
  );
}

export function buildExpressionFromMapping(payload: DraggableKeyPayload): string {
  return `{{ $('${payload.sourceNodeName}').item.json.${payload.path} }}`;
}
