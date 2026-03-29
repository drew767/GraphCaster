// Copyright GraphCaster. All Rights Reserved.

import { useGcCanvasLod } from "../components/GcCanvasLodContext";
import { useGcViewportTier } from "../components/GcViewportTierContext";
import { resolveEffectiveTier, type GcEffectiveNodeTier } from "./viewportNodeTier";

export function useGcEffectiveNodeTier(nodeId: string, selected: boolean): GcEffectiveNodeTier {
  const lod = useGcCanvasLod();
  const { ghostOffViewportEnabled, visibilityById } = useGcViewportTier();
  const visibility = visibilityById.get(nodeId) ?? "in";
  return resolveEffectiveTier(lod, visibility, { ghostOffViewportEnabled, selected });
}
