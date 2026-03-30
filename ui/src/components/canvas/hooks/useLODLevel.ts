// Copyright GraphCaster. All Rights Reserved.

import { useMemo } from "react";

export enum LODLevel {
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  GHOST = "ghost",
}

export const LOD_THRESHOLDS = {
  HIGH: 0.75,
  MEDIUM: 0.4,
  LOW: 0.2,
};

export function useLODLevel(zoom: number): LODLevel {
  return useMemo(() => {
    if (zoom >= LOD_THRESHOLDS.HIGH) {
      return LODLevel.HIGH;
    }
    if (zoom >= LOD_THRESHOLDS.MEDIUM) {
      return LODLevel.MEDIUM;
    }
    if (zoom >= LOD_THRESHOLDS.LOW) {
      return LODLevel.LOW;
    }
    return LODLevel.GHOST;
  }, [zoom]);
}

export function getNodeLODLevel(zoom: number, isSelected: boolean, isRunning: boolean): LODLevel {
  if (isSelected || isRunning) {
    return LODLevel.HIGH;
  }
  if (zoom >= LOD_THRESHOLDS.HIGH) {
    return LODLevel.HIGH;
  }
  if (zoom >= LOD_THRESHOLDS.MEDIUM) {
    return LODLevel.MEDIUM;
  }
  if (zoom >= LOD_THRESHOLDS.LOW) {
    return LODLevel.LOW;
  }
  return LODLevel.GHOST;
}
