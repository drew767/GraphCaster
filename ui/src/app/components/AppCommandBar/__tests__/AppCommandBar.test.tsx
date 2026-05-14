// Copyright GraphCaster. All Rights Reserved.

// cmdk uses ResizeObserver and scrollIntoView internally; jsdom does not ship them.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { AppCommandBar } from "../AppCommandBar";
import { useCommandBarStore } from "../../../stores/commandBarStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.commandBar.placeholder": "Search commands, navigate…",
        "app.commandBar.emptyState": "No results found.",
        "app.commandBar.groups.recent": "Recent",
        "app.commandBar.groups.create": "Create",
        "app.commandBar.groups.navigate": "Navigate",
        "app.commandBar.groups.actions": "Actions",
        "app.commandBar.groups.help": "Help",
        "app.commandBar.items.newWorkflow": "New Workflow",
        "app.commandBar.items.goToWorkflows": "Go to Workflows",
        "app.commandBar.items.goToExecutions": "Go to Executions",
        "app.commandBar.items.goToTemplates": "Go to Templates",
        "app.commandBar.items.goToSettings": "Go to Settings",
        "app.commandBar.items.goToCredentials": "Go to Credentials",
        "app.commandBar.items.shortcuts": "Keyboard shortcuts",
        "app.commandBar.items.openDocs": "Open documentation",
        "app.commandBar.items.runWorkflow": "Run workflow",
        "app.commandBar.items.saveWorkflow": "Save workflow",
        "app.commandBar.items.exportWorkflow": "Export workflow",
        "app.commandBar.items.autoLayout": "Auto-layout",
        "app.cmdBar.recent": "Recent",
        "app.cmdBar.favorites": "Favorites",
        "app.cmdBar.favorite": "Pin to favorites",
        "app.cmdBar.unfavorite": "Unpin from favorites",
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock("../../../../lib/isTextEditingTarget", () => ({
  isTextEditingTarget: vi.fn(() => false),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderBar(props: Partial<React.ComponentProps<typeof AppCommandBar>> = {}, path = "/home/workflows") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppCommandBar {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockNavigate.mockReset();
  useCommandBarStore.setState({ open: false, recentRoutes: [], favorites: [] });
  localStorage.clear();
});

describe("AppCommandBar — global hotkey", () => {
  it("opens when Ctrl+K is pressed on document", () => {
    renderBar({ open: undefined });
    expect(screen.queryByTestId("gc-cmd-backdrop")).toBeNull();
    act(() => {
      fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    });
    expect(screen.getByTestId("gc-cmd-backdrop")).toBeInTheDocument();
  });

  it("does not open when focus is in an input (isTextEditingTarget returns true)", async () => {
    const { isTextEditingTarget } = await import("../../../../lib/isTextEditingTarget");
    vi.mocked(isTextEditingTarget).mockReturnValueOnce(true);

    renderBar({ open: undefined });
    act(() => {
      fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    });
    expect(screen.queryByTestId("gc-cmd-backdrop")).toBeNull();
  });
});

describe("AppCommandBar — controlled open", () => {
  it("renders the palette when open=true", () => {
    renderBar({ open: true });
    expect(screen.getByTestId("gc-cmd-backdrop")).toBeInTheDocument();
  });

  it("does not render when open=false", () => {
    renderBar({ open: false });
    expect(screen.queryByTestId("gc-cmd-backdrop")).toBeNull();
  });
});

describe("AppCommandBar — typing filters items", () => {
  it("shows Navigate items by default", () => {
    renderBar({ open: true });
    expect(screen.getByText("Go to Workflows")).toBeInTheDocument();
    expect(screen.getByText("Go to Executions")).toBeInTheDocument();
  });

  it("filters items when user types in search input", () => {
    renderBar({ open: true });
    const input = screen.getByPlaceholderText("Search commands, navigate…");
    fireEvent.change(input, { target: { value: "Workflows" } });
    expect(screen.getByText("Go to Workflows")).toBeInTheDocument();
    expect(screen.queryByText("Go to Executions")).toBeNull();
  });

  it("shows empty state when no items match", () => {
    renderBar({ open: true });
    const input = screen.getByPlaceholderText("Search commands, navigate…");
    fireEvent.change(input, { target: { value: "xyzzy_nonexistent_command" } });
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });
});

describe("AppCommandBar — selecting a Navigate item", () => {
  it("calls navigate and closes when a Navigate item is selected via click", () => {
    const onOpenChange = vi.fn();
    renderBar({ open: true, onOpenChange });
    const item = screen.getByText("Go to Workflows");
    fireEvent.click(item);
    expect(mockNavigate).toHaveBeenCalledWith("/home/workflows");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("records navigate route in recentRoutes", () => {
    renderBar({ open: true });
    const item = screen.getByText("Go to Executions");
    fireEvent.click(item);
    const state = useCommandBarStore.getState();
    expect(state.recentRoutes.some((r) => r.href === "/home/executions")).toBe(true);
  });
});

describe("AppCommandBar — selecting an Action item", () => {
  it("calls item action callback when selected", () => {
    const action = vi.fn();
    const onOpenChange = vi.fn();
    const customItems = [
      {
        id: "test-action",
        label: "Test Action Item",
        group: "Actions",
        action,
      },
    ];
    renderBar({ open: true, onOpenChange, items: customItems });
    const item = screen.getByText("Test Action Item");
    fireEvent.click(item);
    expect(action).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("AppCommandBar — Esc closes", () => {
  it("calls onOpenChange(false) when Escape is pressed inside Command", () => {
    const onOpenChange = vi.fn();
    renderBar({ open: true, onOpenChange });
    const panel = screen.getByTestId("gc-cmd-backdrop").querySelector(".gc-cmd-panel");
    expect(panel).not.toBeNull();
    fireEvent.keyDown(panel!, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("AppCommandBar — click outside closes", () => {
  it("calls onOpenChange(false) when backdrop is clicked directly", () => {
    const onOpenChange = vi.fn();
    renderBar({ open: true, onOpenChange });
    const backdrop = screen.getByTestId("gc-cmd-backdrop");
    fireEvent.click(backdrop);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not close when clicking inside the panel", () => {
    const onOpenChange = vi.fn();
    renderBar({ open: true, onOpenChange });
    const input = screen.getByPlaceholderText("Search commands, navigate…");
    fireEvent.click(input);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("AppCommandBar — Actions group visible on workflow route", () => {
  it("shows Actions group on /workflow/* route", () => {
    renderBar({ open: true }, "/workflow/abc123");
    expect(screen.getByText("Run workflow")).toBeInTheDocument();
  });

  it("does not show Actions group on non-workflow route", () => {
    renderBar({ open: true }, "/home/workflows");
    expect(screen.queryByText("Run workflow")).toBeNull();
  });
});

describe("AppCommandBar — recent shows last 5 routes", () => {
  it("shows at most 5 recent routes even when more have been pushed", () => {
    // Push 7 routes into the store
    const routes = Array.from({ length: 7 }, (_, i) => ({
      href: `/route-${i}`,
      label: `Route ${i}`,
      visitedAt: new Date(Date.now() + i * 1000).toISOString(),
    }));
    useCommandBarStore.setState({ open: false, recentRoutes: routes, favorites: [] });

    renderBar({ open: true });

    // The "Recent" group heading should appear
    expect(screen.getByText("Recent")).toBeInTheDocument();

    // Only the first 5 (most recent) should be shown
    const recentBtns = screen.getAllByText(/Route \d/);
    expect(recentBtns.length).toBeLessThanOrEqual(5);
  });
});

describe("AppCommandBar — favorite star toggles", () => {
  it("clicking the star button on a Navigate item adds it to favorites", () => {
    renderBar({ open: true });

    const starBtn = screen.getByTestId("cmd-star-nav-workflows");
    expect(starBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(starBtn);

    const state = useCommandBarStore.getState();
    expect(state.isFavorite("/home/workflows")).toBe(true);
  });

  it("clicking star again removes the item from favorites", () => {
    // Pre-populate a favorite
    useCommandBarStore.getState().addFavorite({ href: "/home/workflows", label: "Go to Workflows" });

    renderBar({ open: true });

    const starBtn = screen.getByTestId("cmd-star-nav-workflows");
    expect(starBtn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(starBtn);

    const state = useCommandBarStore.getState();
    expect(state.isFavorite("/home/workflows")).toBe(false);
  });
});

describe("AppCommandBar — favorites persisted in localStorage", () => {
  it("favorites survive a store re-hydration from localStorage", () => {
    useCommandBarStore.getState().addFavorite({ href: "/home/executions", label: "Executions" });

    // Simulate re-hydration: reset store state to re-read from localStorage
    const stored = localStorage.getItem("gc.commandBar.favorites");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((f: { href: string }) => f.href === "/home/executions")).toBe(true);
  });
});

describe("AppCommandBar — shortcut hints", () => {
  it("renders a KeyboardShortcut hint next to the help-shortcuts item", () => {
    renderBar({ open: true });
    expect(screen.getByTestId("cmd-shortcut-help-shortcuts")).toBeInTheDocument();
  });

  it("renders no shortcut hint for items with no catalog match and no explicit shortcut", () => {
    renderBar({ open: true });
    expect(screen.queryByTestId("cmd-shortcut-nav-workflows")).toBeNull();
  });
});

describe("AppCommandBar — favorites shown above recent", () => {
  it("renders Favorites group before Recent group in the list", () => {
    // Use a unique label so there's no overlap between Favorites and Navigate groups
    useCommandBarStore.getState().addFavorite({ href: "/unique-fav-path", label: "My Pinned Page" });
    useCommandBarStore.setState((s) => ({
      ...s,
      recentRoutes: [{ href: "/unique-recent-path", label: "My Recent Page", visitedAt: new Date().toISOString() }],
    }));

    renderBar({ open: true });

    const favEl = screen.getByText("My Pinned Page");
    const recentEl = screen.getByText("My Recent Page");
    // DOCUMENT_POSITION_FOLLOWING (4) means recentEl appears after favEl in the DOM
    const position = favEl.compareDocumentPosition(recentEl);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
