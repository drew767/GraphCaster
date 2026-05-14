// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export type ModalKey = string;

interface ModalEntry {
  open: boolean;
  payload?: unknown;
}

interface UIState {
  modals: Record<ModalKey, ModalEntry>;
  openModal: (key: ModalKey, payload?: unknown) => void;
  closeModal: (key: ModalKey) => void;
  isModalOpen: (key: ModalKey) => boolean;
  getModalPayload: <T = unknown>(key: ModalKey) => T | undefined;
}

export const useUIStore = create<UIState>((set, get) => ({
  modals: {},

  openModal: (key, payload) => {
    set((state) => ({
      modals: {
        ...state.modals,
        [key]: { open: true, payload },
      },
    }));
  },

  closeModal: (key) => {
    set((state) => ({
      modals: {
        ...state.modals,
        [key]: { open: false, payload: state.modals[key]?.payload },
      },
    }));
  },

  isModalOpen: (key) => {
    return get().modals[key]?.open ?? false;
  },

  getModalPayload: <T = unknown>(key: ModalKey): T | undefined => {
    return get().modals[key]?.payload as T | undefined;
  },
}));
