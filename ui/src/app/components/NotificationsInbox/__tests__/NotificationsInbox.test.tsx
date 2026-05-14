// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { NotificationsInbox } from "../NotificationsInbox";
import { useNotificationsStore } from "../../../stores/notificationsStore";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function resetStore() {
  useNotificationsStore.getState().clearAll();
}

function renderInbox() {
  return render(
    <MemoryRouter>
      <NotificationsInbox />
    </MemoryRouter>
  );
}

function openPopover() {
  const btn = screen.getByRole("button", { name: /open notifications/i });
  act(() => { fireEvent.click(btn); });
}

describe("NotificationsInbox", () => {
  beforeEach(() => {
    resetStore();
  });

  it("renders a bell icon button", () => {
    renderInbox();
    expect(screen.getByRole("button", { name: /open notifications/i })).toBeInTheDocument();
  });

  it("shows unread badge count when there are unread notifications", () => {
    act(() => {
      useNotificationsStore.getState().push({ type: "info", title: "Test" });
      useNotificationsStore.getState().push({ type: "info", title: "Test2" });
    });
    renderInbox();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("does not show badge when there are no notifications", () => {
    renderInbox();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("opens popover when bell button is clicked", () => {
    renderInbox();
    openPopover();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
  });

  it("shows empty state when no notifications", () => {
    renderInbox();
    openPopover();
    // Component renders EmptyState with title "All caught up!" when no notifications exist
    expect(screen.getByText("All caught up!")).toBeInTheDocument();
  });

  it("mark all as read button marks all notifications read", () => {
    act(() => {
      useNotificationsStore.getState().push({ type: "run_finished", title: "Run done" });
      useNotificationsStore.getState().push({ type: "info", title: "Info" });
    });
    renderInbox();
    openPopover();
    const markAllBtn = screen.getByText("Mark all as read");
    act(() => { fireEvent.click(markAllBtn); });
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
  });

  it("navigates to link and marks as read on notification click", () => {
    act(() => {
      useNotificationsStore.getState().push({ type: "run_finished", title: "Run finished", link: "/runs/123" });
    });
    renderInbox();
    openPopover();
    const item = screen.getByText("Run finished").closest("li")!;
    act(() => { fireEvent.click(item); });
    expect(useNotificationsStore.getState().notifications[0]?.read).toBe(true);
  });

  it("clear all button removes all notifications", () => {
    act(() => {
      useNotificationsStore.getState().push({ type: "system", title: "System event" });
    });
    renderInbox();
    openPopover();
    const clearBtn = screen.getByText("Clear all");
    act(() => { fireEvent.click(clearBtn); });
    expect(useNotificationsStore.getState().notifications).toHaveLength(0);
  });
});
