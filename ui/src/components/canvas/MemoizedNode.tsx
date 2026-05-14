// Copyright GraphCaster. All Rights Reserved.

import type { ComponentType } from "react";
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

export interface NodeRenderProps {
  id: string;
  data: Record<string, unknown>;
  selected: boolean;
  dragging?: boolean;
  width?: number | null;
  height?: number | null;
  positionAbsoluteX?: number;
  positionAbsoluteY?: number;
}

/**
 * Custom equality for memoized canvas nodes.
 *
 * Trade-off: we deep-walk only the **top level** of `data` via `shallowEqual` rather than running
 * a full structural comparison. Deeper equality would prevent more re-renders, but the per-frame
 * cost across hundreds of nodes is prohibitive (xyflow re-emits node props on every pan/zoom).
 * Shallow equality is fast, but it relies on callers (parent components) to pass **stable function
 * references** in `data` — pass a fresh closure and the memo correctly invalidates so handlers do
 * not capture stale state. Internal xyflow props (`dragging`, `width`, `height`,
 * `positionAbsoluteX`, `positionAbsoluteY`) must be included or a dragged node would visually
 * "stick" because React would skip re-rendering even though geometry changed.
 */
export function areNodePropsEqual(prevProps: NodeRenderProps, nextProps: NodeRenderProps): boolean {
  if (prevProps.id !== nextProps.id) {
    return false;
  }
  if (prevProps.selected !== nextProps.selected) {
    return false;
  }
  if (prevProps.dragging !== nextProps.dragging) {
    return false;
  }
  if (prevProps.width !== nextProps.width) {
    return false;
  }
  if (prevProps.height !== nextProps.height) {
    return false;
  }
  if (prevProps.positionAbsoluteX !== nextProps.positionAbsoluteX) {
    return false;
  }
  if (prevProps.positionAbsoluteY !== nextProps.positionAbsoluteY) {
    return false;
  }
  if (!shallowEqual(prevProps.data, nextProps.data)) {
    return false;
  }
  return true;
}

function shallowEqual(
  obj1: Record<string, unknown>,
  obj2: Record<string, unknown>,
): boolean {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    if (obj1[key] !== obj2[key]) {
      return false;
    }
  }

  return true;
}

export function MemoizedNode<T extends NodeProps>(Component: ComponentType<T>): ComponentType<T> {
  return memo(Component, areNodePropsEqual as (a: T, b: T) => boolean) as unknown as ComponentType<T>;
}

export function createMemoizedNode<T extends NodeProps>(
  Component: ComponentType<T>,
  displayName?: string,
): ComponentType<T> {
  const MemoizedComponent = memo(Component, areNodePropsEqual as (a: T, b: T) => boolean) as unknown as ComponentType<T>;
  MemoizedComponent.displayName = displayName || `Memoized(${Component.displayName || Component.name || "Node"})`;
  return MemoizedComponent;
}
