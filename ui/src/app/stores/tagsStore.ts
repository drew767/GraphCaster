// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export interface TagsStore {
  tags: string[];
  setTags: (tags: string[]) => void;
  addTag: (name: string) => void;
  removeTag: (name: string) => void;
}

export const useTagsStore = create<TagsStore>((set) => ({
  tags: [],
  setTags: (tags) => set({ tags: dedupe(tags) }),
  addTag: (name) =>
    set((state) => {
      const trimmed = name.trim();
      if (!trimmed) return state;
      if (state.tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
        return state;
      }
      return { tags: [...state.tags, trimmed] };
    }),
  removeTag: (name) =>
    set((state) => ({ tags: state.tags.filter((t) => t !== name) })),
}));

function dedupe(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
