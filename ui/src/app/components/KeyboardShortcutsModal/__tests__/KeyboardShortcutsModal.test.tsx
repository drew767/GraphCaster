// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeAll } from "vitest";

import { KeyboardShortcutsModal } from "../KeyboardShortcutsModal";

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
        "shortcuts.modal.title": "Keyboard shortcuts",
        "shortcuts.modal.searchPlaceholder": "Search shortcuts…",
        "shortcuts.modal.noResults": "No shortcuts match your search.",
        "shortcuts.modal.or": "or",
        "shortcuts.modal.category.edit": "Editor",
        "shortcuts.modal.category.view": "Canvas",
        "shortcuts.modal.category.navigation": "Navigation",
        "shortcuts.modal.category.selection": "Selection",
        "shortcuts.modal.category.run": "Workflow",
        "app.shortcuts.undo": "Undo",
        "app.shortcuts.redo": "Redo",
        "app.shortcuts.commandBar": "Open command bar",
        "app.shortcuts.showKeyboardShortcuts": "Show keyboard shortcuts",
        "app.shortcuts.keys.showKeyboardShortcuts": "?",
        "app.shortcuts.keys.undo": "Ctrl+Z",
        "app.shortcuts.keys.redo": "Ctrl+Shift+Z or Ctrl+Y",
        "app.shortcuts.keys.commandBar": "Ctrl+K",
      };
      return map[key] ?? key;
    },
  }),
}));

describe("KeyboardShortcutsModal", () => {
  it("renders title and category headings when open", () => {
    render(<KeyboardShortcutsModal open onOpenChange={() => {}} />);
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
    expect(screen.getByTestId("shortcuts-modal")).toBeInTheDocument();
    expect(screen.getByText("Editor")).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
  });

  it("renders an entry for the ? shortcut", () => {
    render(<KeyboardShortcutsModal open onOpenChange={() => {}} />);
    expect(screen.getByText("Show keyboard shortcuts")).toBeInTheDocument();
  });

  it("filters rows by search input", () => {
    render(<KeyboardShortcutsModal open onOpenChange={() => {}} />);
    expect(screen.getByText("Open command bar")).toBeInTheDocument();
    expect(screen.getByText("Undo")).toBeInTheDocument();

    const input = screen.getByTestId("shortcuts-modal-search") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "undo" } });
    });

    expect(screen.getByText("Undo")).toBeInTheDocument();
    expect(screen.queryByText("Open command bar")).not.toBeInTheDocument();
  });

  it("shows no-results state when no matches", () => {
    render(<KeyboardShortcutsModal open onOpenChange={() => {}} />);
    const input = screen.getByTestId("shortcuts-modal-search") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "zzzzzzzz-no-match" } });
    });
    expect(screen.getByText("No shortcuts match your search.")).toBeInTheDocument();
  });
});
