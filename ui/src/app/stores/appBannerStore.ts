// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export interface Banner {
  id: string;
  type: "info" | "warning" | "error" | "success";
  title?: React.ReactNode;
  message: React.ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  dismissible?: boolean;
  persistent?: boolean;
}

interface BannerState {
  banners: Banner[];
  push: (banner: Omit<Banner, "id"> & { id?: string }) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

let _counter = 0;

export const useAppBannerStore = create<BannerState>((set) => ({
  banners: [],

  push: (banner) => {
    const id = banner.id ?? `banner-${++_counter}`;
    set((state) => ({
      banners: [...state.banners, { ...banner, id }],
    }));
    return id;
  },

  dismiss: (id) => {
    set((state) => ({
      banners: state.banners.filter((b) => b.id !== id),
    }));
  },

  dismissAll: () => {
    set({ banners: [] });
  },
}));
