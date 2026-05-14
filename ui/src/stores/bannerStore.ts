// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export type BannerType = "info" | "warning" | "error" | "promo";

export interface BannerAction {
  label: string;
  onClick: () => void;
}

export interface Banner {
  id: string;
  type: BannerType;
  message: string;
  action?: BannerAction;
  dismissible?: boolean;
}

type BannerInput = Omit<Banner, "id"> & { id?: string };

interface BannerStoreState {
  banners: Banner[];
  push: (banner: BannerInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `banner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useBannerStore = create<BannerStoreState>((set) => ({
  banners: [],
  push: (banner) => {
    const id = banner.id ?? makeId();
    set((state) => {
      if (state.banners.some((b) => b.id === id)) {
        return state;
      }
      const next: Banner = {
        id,
        type: banner.type,
        message: banner.message,
        action: banner.action,
        dismissible: banner.dismissible ?? true,
      };
      return { banners: [...state.banners, next] };
    });
    return id;
  },
  dismiss: (id) => {
    set((state) => ({ banners: state.banners.filter((b) => b.id !== id) }));
  },
  clear: () => {
    set({ banners: [] });
  },
}));
