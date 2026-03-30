// Copyright GraphCaster. All Rights Reserved.

import type { ComponentType } from "react";
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

export interface NodeRenderProps {
  id: string;
  data: Record<string, unknown>;
  selected: boolean;
  dragging?: boolean;
}

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
