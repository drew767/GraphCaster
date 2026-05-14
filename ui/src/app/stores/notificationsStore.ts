// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export interface Notification {
  id: string;
  type:
    | "run_finished"
    | "run_failed"
    | "webhook_fired"
    | "user_joined"
    | "plugin_updated"
    | "system"
    | "info";
  title: React.ReactNode;
  message?: React.ReactNode;
  timestamp: string;
  read: boolean;
  link?: string;
  action?: { label: string; onClick: () => void };
}

export interface NotificationsState {
  notifications: Notification[];
  unreadCount: number;
  push: (n: Omit<Notification, "id" | "timestamp" | "read"> & { id?: string; read?: boolean }) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
  /** @deprecated alias for clear; kept for backwards compatibility */
  clearAll: () => void;
}

const STORAGE_KEY = "gc.notifications";
const MAX_PERSISTED = 50;

function computeUnread(notifications: Notification[]): number {
  return notifications.filter((n) => !n.read).length;
}

function isPersistable(value: unknown): value is string {
  return typeof value === "string";
}

function loadPersisted(): Notification[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: Notification[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (!isPersistable(e.id) || !isPersistable(e.timestamp) || !isPersistable(e.type)) continue;
      // Only persist string titles/messages — React nodes are not serialisable.
      const title = isPersistable(e.title) ? e.title : "";
      const message = isPersistable(e.message) ? e.message : undefined;
      out.push({
        id: e.id,
        type: e.type as Notification["type"],
        title,
        message,
        timestamp: e.timestamp,
        read: e.read === true,
        link: isPersistable(e.link) ? e.link : undefined,
      });
    }
    return out.slice(0, MAX_PERSISTED);
  } catch {
    return [];
  }
}

function persist(notifications: Notification[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const serialisable = notifications.slice(0, MAX_PERSISTED).map((n) => ({
      id: n.id,
      type: n.type,
      title: typeof n.title === "string" ? n.title : "",
      message: typeof n.message === "string" ? n.message : undefined,
      timestamp: n.timestamp,
      read: n.read,
      link: n.link,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialisable));
  } catch {
    /* ignore quota or serialisation failures */
  }
}

const initial = loadPersisted();

export const useNotificationsStore = create<NotificationsState>((set) => ({
  notifications: initial,
  unreadCount: computeUnread(initial),

  push: (n) => {
    const newNotification: Notification = {
      type: n.type,
      title: n.title,
      message: n.message,
      link: n.link,
      action: n.action,
      id: n.id ?? crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      read: n.read === true,
    };
    set((state) => {
      const notifications = [newNotification, ...state.notifications].slice(0, MAX_PERSISTED);
      persist(notifications);
      return { notifications, unreadCount: computeUnread(notifications) };
    });
  },

  markRead: (id) => {
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      persist(notifications);
      return { notifications, unreadCount: computeUnread(notifications) };
    });
  },

  markAllRead: () => {
    set((state) => {
      const notifications = state.notifications.map((n) => ({ ...n, read: true }));
      persist(notifications);
      return { notifications, unreadCount: 0 };
    });
  },

  remove: (id) => {
    set((state) => {
      const notifications = state.notifications.filter((n) => n.id !== id);
      persist(notifications);
      return { notifications, unreadCount: computeUnread(notifications) };
    });
  },

  clear: () => {
    persist([]);
    set({ notifications: [], unreadCount: 0 });
  },

  clearAll: () => {
    persist([]);
    set({ notifications: [], unreadCount: 0 });
  },
}));
