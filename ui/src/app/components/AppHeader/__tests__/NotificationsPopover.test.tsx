// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";

import { AppHeaderContent } from "../AppHeader";
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.header.notifications": "Notifications",
        "notifications.heading": "Notifications",
        "notifications.markAllRead": "Mark all as read",
        "notifications.empty.title": "No notifications yet",
        "notifications.justNow": "just now",
        "app.header.tabs.editor": "Editor",
        "app.header.tabs.executions": "Executions",
        "app.header.tabs.tests": "Tests",
        "app.header.tabs.ariaLabel": "Workflow views",
        "app.header.breadcrumbs.workflows": "Workflows",
        "app.header.breadcrumbs.editor": "Editor",
        "app.header.breadcrumbs.home": "Home",
        "app.header.breadcrumbs.executions": "Executions",
        "app.header.breadcrumbs.settings": "Settings",
        "app.header.workflowNamePlaceholder": "Workflow name",
        "app.header.unsavedChanges": "Unsaved",
      };
      return map[key] ?? key;
    },
  }),
}));

function resetStore() {
  useNotificationsStore.getState().clear();
}

function renderHeader() {
  return render(
    <MemoryRouter initialEntries={["/home/workflows"]}>
      <AppHeaderContent />
    </MemoryRouter>,
  );
}

describe("AppHeader notifications popover", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it("opens popover with empty state when no notifications", () => {
    renderHeader();
    const bell = screen.getByRole("button", { name: "Notifications" });
    act(() => {
      fireEvent.click(bell);
    });
    expect(screen.getByText("No notifications yet")).toBeInTheDocument();
  });

  it("renders pushed notifications in the popover list", () => {
    act(() => {
      useNotificationsStore.getState().push({ type: "info", title: "Hello world" });
      useNotificationsStore.getState().push({ type: "run_finished", title: "Run done" });
    });
    renderHeader();
    const bell = screen.getByRole("button", { name: "Notifications" });
    act(() => {
      fireEvent.click(bell);
    });
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByText("Run done")).toBeInTheDocument();
  });

  it("shows badge with unread count from the store", () => {
    act(() => {
      useNotificationsStore.getState().push({ type: "info", title: "A" });
      useNotificationsStore.getState().push({ type: "info", title: "B" });
      useNotificationsStore.getState().push({ type: "info", title: "C" });
    });
    renderHeader();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("Mark all as read clears the unread count", () => {
    act(() => {
      useNotificationsStore.getState().push({ type: "info", title: "X" });
      useNotificationsStore.getState().push({ type: "info", title: "Y" });
    });
    renderHeader();
    const bell = screen.getByRole("button", { name: "Notifications" });
    act(() => {
      fireEvent.click(bell);
    });
    const markAll = screen.getByText("Mark all as read");
    act(() => {
      fireEvent.click(markAll);
    });
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
  });
});
