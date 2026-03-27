// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "../graph/types";
import { markStepCacheDirtyTransitive } from "./stepCacheDirtyStore";

export type NestedGraphRefFrame = {
  parentWorkspaceFileName: string;
  graphRefNodeId: string;
};

export async function replayNestedGraphRefDirtyStack(
  stack: readonly NestedGraphRefFrame[],
  readParentDoc: (fileName: string) => Promise<GraphDocumentJson | null>,
): Promise<void> {
  for (const frame of stack) {
    const parentDoc = await readParentDoc(frame.parentWorkspaceFileName);
    if (parentDoc != null) {
      markStepCacheDirtyTransitive(parentDoc, [frame.graphRefNodeId]);
    }
  }
}

export async function markStepCacheDirtyWithNestedBubble(
  nextDoc: GraphDocumentJson,
  seeds: readonly string[],
  stack: readonly NestedGraphRefFrame[],
  readParentDoc: (fileName: string) => Promise<GraphDocumentJson | null>,
): Promise<void> {
  markStepCacheDirtyTransitive(nextDoc, seeds);
  await replayNestedGraphRefDirtyStack(stack, readParentDoc);
}
