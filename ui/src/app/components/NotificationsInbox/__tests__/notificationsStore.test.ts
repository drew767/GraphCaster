// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach } from "vitest";
import { useNotificationsStore } from "../../../stores/notificationsStore";

function resetStore() {
  useNotificationsStore.getState().clearAll();
}

describe("notificationsStore", () => {
  beforeEach(() => {
    resetStore();
  });

  it("starts empty with zero unread count", () => {
    const state = useNotificationsStore.getState();
    expect(state.notifications).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
  });

  it("push adds a notification and increments unreadCount", () => {
    const { push } = useNotificationsStore.getState();
    push({ type: "info", title: "Hello" });
    const state = useNotificationsStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.unreadCount).toBe(1);
    expect(state.notifications[0]?.type).toBe("info");
    expect(state.notifications[0]?.title).toBe("Hello");
    expect(state.notifications[0]?.id).toBeTruthy();
    expect(state.notifications[0]?.timestamp).toBeTruthy();
  });

  it("markRead marks a single notification as read and decrements unreadCount", () => {
    const { push, markRead } = useNotificationsStore.getState();
    push({ type: "run_finished", title: "Done" });
    push({ type: "run_failed", title: "Error" });
    const id = useNotificationsStore.getState().notifications[0]!.id;
    markRead(id);
    const state = useNotificationsStore.getState();
    expect(state.unreadCount).toBe(1);
    expect(state.notifications.find((n) => n.id === id)?.read).toBe(true);
  });

  it("markAllRead sets all to read and resets unreadCount to 0", () => {
    const { push, markAllRead } = useNotificationsStore.getState();
    push({ type: "info", title: "A" });
    push({ type: "info", title: "B" });
    markAllRead();
    const state = useNotificationsStore.getState();
    expect(state.unreadCount).toBe(0);
    expect(state.notifications.every((n) => n.read)).toBe(true);
  });

  it("remove deletes a notification and updates unreadCount", () => {
    const { push, remove } = useNotificationsStore.getState();
    push({ type: "system", title: "Sys" });
    const id = useNotificationsStore.getState().notifications[0]!.id;
    remove(id);
    const state = useNotificationsStore.getState();
    expect(state.notifications).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
  });

  it("clearAll removes all notifications", () => {
    const { push, clearAll } = useNotificationsStore.getState();
    push({ type: "info", title: "X" });
    push({ type: "info", title: "Y" });
    clearAll();
    const state = useNotificationsStore.getState();
    expect(state.notifications).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
  });

  it("push with explicit id uses the provided id", () => {
    const { push } = useNotificationsStore.getState();
    push({ id: "my-id", type: "webhook_fired", title: "Hook" });
    const state = useNotificationsStore.getState();
    expect(state.notifications[0]?.id).toBe("my-id");
  });
});
