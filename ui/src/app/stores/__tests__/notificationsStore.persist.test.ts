// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, beforeEach } from "vitest";

import { useNotificationsStore } from "../notificationsStore";

const STORAGE_KEY = "gc.notifications";

function resetState() {
  useNotificationsStore.getState().clear();
}

describe("notificationsStore persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    resetState();
  });

  it("persists pushed notifications to localStorage", () => {
    useNotificationsStore.getState().push({ type: "info", title: "Hello" });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? "[]") as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("Hello");
    expect(parsed[0]?.type).toBe("info");
  });

  it("clear() removes all entries from storage", () => {
    useNotificationsStore.getState().push({ type: "info", title: "Hello" });
    useNotificationsStore.getState().clear();
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
    expect(parsed).toEqual([]);
  });

  it("trims persisted entries to the last 50", () => {
    for (let i = 0; i < 60; i += 1) {
      useNotificationsStore.getState().push({ type: "info", title: `t${i}` });
    }
    expect(useNotificationsStore.getState().notifications).toHaveLength(50);
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw ?? "[]") as unknown[];
    expect(parsed).toHaveLength(50);
  });

  it("markAllRead persists read state", () => {
    useNotificationsStore.getState().push({ type: "info", title: "a" });
    useNotificationsStore.getState().push({ type: "info", title: "b" });
    useNotificationsStore.getState().markAllRead();
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw ?? "[]") as Array<Record<string, unknown>>;
    expect(parsed.every((n) => n.read === true)).toBe(true);
  });
});
