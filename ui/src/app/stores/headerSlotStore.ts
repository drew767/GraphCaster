// Copyright GraphCaster. All Rights Reserved.

import type { ReactNode } from "react";
import { create } from "zustand";

export type HeaderSlotContent = ReactNode | null;

export interface HeaderSlotStore {
  left: HeaderSlotContent;
  center: HeaderSlotContent;
  right: HeaderSlotContent;
  setSlots: (
    slots: Partial<Pick<HeaderSlotStore, "left" | "center" | "right">>,
  ) => void;
  clear: () => void;
}

export const useHeaderSlotStore = create<HeaderSlotStore>((set) => ({
  left: null,
  center: null,
  right: null,
  setSlots: (slots) => set((state) => ({ ...state, ...slots })),
  clear: () => set({ left: null, center: null, right: null }),
}));
