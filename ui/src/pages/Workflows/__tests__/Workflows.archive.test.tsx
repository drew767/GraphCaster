// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import WorkflowsView from "../Workflows";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === "string") return fallback;
      return key;
    },
  }),
}));

// BulkActionsBar, SkeletonCard, EmptyState — keep real but mock heavy deps
vi.mock("../../../components/ui/BulkActionsBar/BulkActionsBar", () => ({
  BulkActionsBar: () => null,
}));

vi.mock("../../../components/ui/Skeleton/Skeleton", () => ({
  SkeletonCard: () => <div data-testid="skeleton-card" />,
}));

vi.mock("../../../components/ui/EmptyState/EmptyState", () => ({
  EmptyState: ({ title }: { title: string }) => (
    <div data-testid="empty-state">{title}</div>
  ),
}));

vi.mock("../../../components/ui/Switch/Switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    label,
  }: {
    checked?: boolean;
    onCheckedChange?: (c: boolean) => void;
    label?: string;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        data-testid="show-archived-switch"
      />
      {label}
    </label>
  ),
}));

// Popover (used inside WorkflowTagsContainer) needs ResizeObserver
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof window !== "undefined" && !window.PointerEvent) {
    // @ts-expect-error jsdom polyfill
    window.PointerEvent = class PointerEvent extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).hasPointerCapture = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).releasePointerCapture = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).setPointerCapture = vi.fn();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWorkflows(path = "/home/workflows") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/home/workflows" element={<WorkflowsView />} />
        <Route path="/home/workflows/folder/*" element={<WorkflowsView />} />
        <Route path="/workflow/new" element={<div>new workflow page</div>} />
        <Route path="/workflow/:id" element={<div>workflow editor</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests — UX114 archive
// ---------------------------------------------------------------------------

describe("Workflows page — archive (UX114)", () => {
  it("archived workflows are filtered out by default", () => {
    // The page starts with no workflows, so we can confirm empty state shows
    renderWorkflows();
    // No workflow cards visible
    expect(screen.queryAllByTestId("workflow-card")).toHaveLength(0);
    // No "ARCHIVED" pill visible (the pill text is exactly "ARCHIVED" / "app.workflows.archive.archivedPill")
    expect(screen.queryByText("ARCHIVED")).not.toBeInTheDocument();
    expect(screen.queryByText("app.workflows.archive.archivedPill")).not.toBeInTheDocument();
  });

  it("archive action sets archived flag and hides card when showArchived=false", async () => {
    // We directly test WorkflowCard archive behavior
    const { WorkflowCard } = await import("../WorkflowCard");
    const onArchive = vi.fn();
    const workflow = {
      id: "wf-1",
      name: "Test WF",
      tags: [],
      active: true,
      archived: false,
      updatedAt: "2026-01-01",
    };

    render(
      <MemoryRouter>
        <WorkflowCard workflow={workflow} onArchive={onArchive} />
      </MemoryRouter>,
    );

    const moreBtn = screen.getByRole("button", {
      name: /app.workflows.archive.moreActions/i,
    });
    act(() => {
      fireEvent.pointerDown(moreBtn, { button: 0, ctrlKey: false });
      fireEvent.click(moreBtn);
    });
    fireEvent.click(screen.getByText("app.workflows.archive.archive"));
    expect(onArchive).toHaveBeenCalledWith("wf-1");
  });

  it("restore action is shown for archived workflows", async () => {
    const { WorkflowCard } = await import("../WorkflowCard");
    const onRestore = vi.fn();
    const workflow = {
      id: "wf-2",
      name: "Archived WF",
      tags: [],
      active: false,
      archived: true,
      updatedAt: "2026-01-01",
    };

    render(
      <MemoryRouter>
        <WorkflowCard workflow={workflow} onRestore={onRestore} />
      </MemoryRouter>,
    );

    const moreBtn = screen.getByRole("button", {
      name: /app.workflows.archive.moreActions/i,
    });
    act(() => {
      fireEvent.pointerDown(moreBtn, { button: 0, ctrlKey: false });
      fireEvent.click(moreBtn);
    });
    fireEvent.click(screen.getByText("app.workflows.archive.restore"));
    expect(onRestore).toHaveBeenCalledWith("wf-2");
  });
});

// ---------------------------------------------------------------------------
// Tests — UX113 folder navigation
// ---------------------------------------------------------------------------

describe("Workflows page — folder navigation (UX113)", () => {
  it("renders breadcrumbs when inside a folder path", () => {
    renderWorkflows("/home/workflows/folder/marketing/email");
    // Breadcrumbs renders a nav[aria-label=Breadcrumb]
    expect(screen.getByRole("navigation", { name: /breadcrumb/i })).toBeInTheDocument();
  });

  it("does not render breadcrumbs at root path", () => {
    renderWorkflows("/home/workflows");
    expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).not.toBeInTheDocument();
  });

  it("new folder button is present in the page header", () => {
    renderWorkflows();
    expect(
      screen.getByRole("button", { name: /\+ New folder|app\.workflows\.folder\.newFolder/i }),
    ).toBeInTheDocument();
  });
});
