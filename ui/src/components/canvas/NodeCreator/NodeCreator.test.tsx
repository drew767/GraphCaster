// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// --- i18n mock ---
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.nodeCreator.modalLabel": "Node Creator",
        "app.nodeCreator.searchPlaceholder": "Search nodes…",
        "app.nodeCreator.filterChipsLabel": "Filter by type",
        "app.nodeCreator.chip.all": "All",
        "app.nodeCreator.chip.triggers": "Triggers",
        "app.nodeCreator.chip.actions": "Actions",
        "app.nodeCreator.categoriesLabel": "Categories",
        "app.nodeCreator.catAll": "All",
        "app.nodeCreator.catFlow": "Flow",
        "app.nodeCreator.catSteps": "Run & AI",
        "app.nodeCreator.catNotes": "Notes",
        "app.nodeCreator.catNested": "Nested",
        "app.nodeCreator.gridLabel": "Node types",
        "app.nodeCreator.recentHeading": "Recently used",
        "app.nodeCreator.allNodesHeading": "All nodes",
        "app.nodeCreator.emptyState": "No nodes match your search.",
        "app.nodeCreator.previewLabel": "Node preview",
        "app.nodeCreator.previewHint": "Hover or navigate to a node to preview it.",
        "app.nodeCreator.insertBtn": "Insert",
      };
      return map[key] ?? key;
    },
  }),
}));

// --- Radix Dialog mock: renders children inline ---
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog-root">{children}</div> : null,
  Trigger: ({ children }: { children: React.ReactNode }) => children,
  Portal: ({ children }: { children: React.ReactNode }) => children,
  Overlay: () => <div data-testid="dialog-overlay" />,
  Content: ({ children, ...rest }: { children: React.ReactNode; [k: string]: unknown }) => (
    <div data-testid="dialog-content" {...rest}>{children}</div>
  ),
  Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  Description: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  Close: ({ children }: { children: React.ReactNode }) => children,
}));

// --- Icon mock ---
vi.mock("../../ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

// --- Button mock ---
vi.mock("../../ui/Button/Button", () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

// --- Dialog mock (the GC wrapper) ---
vi.mock("../../ui/Dialog/Dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open?: boolean;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => open ? <div data-testid="gc-dialog">{children}</div> : null,
}));

// --- localStorage mock ---
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(global, "localStorage", { value: localStorageMock });

import { NodeCreator } from "./NodeCreator";

function renderOpen(
  overrides: Partial<React.ComponentProps<typeof NodeCreator>> = {},
) {
  const onClose = vi.fn();
  const onInsert = vi.fn();
  render(
    <NodeCreator
      open={true}
      onClose={onClose}
      onInsert={onInsert}
      {...overrides}
    />,
  );
  return { onClose, onInsert };
}

describe("NodeCreator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it("renders nothing when open=false", () => {
    const { onInsert } = renderOpen({ open: false });
    expect(screen.queryByTestId("node-creator")).toBeNull();
    void onInsert; // used
  });

  it("renders the modal when open=true", () => {
    renderOpen();
    expect(screen.getByTestId("node-creator")).toBeInTheDocument();
  });

  it("shows search input with placeholder", () => {
    renderOpen();
    expect(screen.getByTestId("node-creator-search")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search nodes…")).toBeInTheDocument();
  });

  it("filters nodes by search query", () => {
    renderOpen();
    const input = screen.getByTestId("node-creator-search");
    fireEvent.change(input, { target: { value: "task" } });
    expect(screen.getByTestId("node-card-task")).toBeInTheDocument();
    expect(screen.queryByTestId("node-card-start")).toBeNull();
  });

  it("shows empty state when no nodes match query", () => {
    renderOpen();
    const input = screen.getByTestId("node-creator-search");
    fireEvent.change(input, { target: { value: "xqznosuchthing99" } });
    expect(screen.getByTestId("node-creator-empty")).toBeInTheDocument();
    expect(screen.getByText("No nodes match your search.")).toBeInTheDocument();
  });

  it("filter chip Triggers shows only trigger/start nodes", () => {
    renderOpen();
    fireEvent.click(screen.getByText("Triggers"));
    expect(screen.getByTestId("node-card-start")).toBeInTheDocument();
    expect(screen.getByTestId("node-card-trigger_webhook")).toBeInTheDocument();
    expect(screen.queryByTestId("node-card-task")).toBeNull();
  });

  it("filter chip Actions hides trigger nodes", () => {
    renderOpen();
    fireEvent.click(screen.getByText("Actions"));
    expect(screen.queryByTestId("node-card-start")).toBeNull();
    expect(screen.queryByTestId("node-card-trigger_webhook")).toBeNull();
    expect(screen.getByTestId("node-card-task")).toBeInTheDocument();
  });

  it("category nav filters to flow category", () => {
    renderOpen();
    const nav = screen.getByRole("navigation", { name: "Categories" });
    fireEvent.click(within(nav).getByText("Flow"));
    expect(screen.getByTestId("node-card-start")).toBeInTheDocument();
    expect(screen.queryByTestId("node-card-task")).toBeNull();
  });

  it("calls onInsert with nodeType when node card clicked", () => {
    const { onInsert } = renderOpen();
    fireEvent.click(screen.getByTestId("node-card-task"));
    expect(onInsert).toHaveBeenCalledWith("task", undefined);
  });

  it("shows recently used section after a node is inserted", () => {
    localStorageMock.setItem("gc.nodeCreator.recentlyUsed", JSON.stringify(["task"]));
    renderOpen();
    expect(screen.getByText("Recently used")).toBeInTheDocument();
  });

  it("keyboard ArrowDown moves focus to next card and Enter inserts", () => {
    const { onInsert } = renderOpen();
    const creator = screen.getByTestId("node-creator");
    // Focus first (index 0), arrow down moves to index 1
    fireEvent.keyDown(creator, { key: "ArrowDown" });
    fireEvent.keyDown(creator, { key: "Enter" });
    // Should have inserted whatever is at index 1
    expect(onInsert).toHaveBeenCalledTimes(1);
  });
});
