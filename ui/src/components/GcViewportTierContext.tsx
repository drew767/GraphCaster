// Copyright GraphCaster. All Rights Reserved.

import { createContext, useContext, type ReactNode } from "react";

import {
  EMPTY_NODE_VISIBILITY_BY_ID,
  type GcViewportNodeClass,
} from "../graph/viewportNodeTier";

export type GcViewportTierContextValue = {
  /** When false, map is ignored and nodes use zoom LOD only. */
  ghostOffViewportEnabled: boolean;
  visibilityById: ReadonlyMap<string, GcViewportNodeClass>;
};

const Ctx = createContext<GcViewportTierContextValue | null>(null);

export function GcViewportTierProvider(props: {
  value: GcViewportTierContextValue;
  children: ReactNode;
}) {
  return <Ctx.Provider value={props.value}>{props.children}</Ctx.Provider>;
}

export function useGcViewportTier(): GcViewportTierContextValue {
  const v = useContext(Ctx);
  if (v === null) {
    return { ghostOffViewportEnabled: false, visibilityById: EMPTY_NODE_VISIBILITY_BY_ID };
  }
  return v;
}
