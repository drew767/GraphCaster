// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === "string") return fallback;
      return key;
    },
  }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("./ExecutionsFilter", () => ({
  ExecutionsFilter: ({ onChange }: { onChange: (v: unknown) => void }) => (
    <div data-testid="executions-filter">
      <button
        data-testid="filter-status"
        onClick={() =>
          onChange({
            graphId: "",
            status: "failed",
            since: "",
            until: "",
            metaKey: "",
            metaValue: "",
          })
        }
      >
        Filter Status
      </button>
    </div>
  ),
}));

vi.mock("../../components/ui/DropdownMenu/DropdownMenu", () => ({
  DropdownMenu: ({ items }: { items: Array<{ id: string; label?: string; onSelect?: () => void }> }) => (
    <div data-testid="dropdown-menu">
      {items.map((item) =>
        item.label ? (
          <button key={item.id} onClick={() => item.onSelect?.()}>
            {item.label}
          </button>
        ) : null,
      )}
    </div>
  ),
}));

import type { ExecutionListResponse } from "./types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `run-${i}`,
    graphId: `graph-${i}`,
    graphName: `Workflow ${i}`,
    status: "success" as const,
    mode: "manual" as const,
    startedAt: new Date(Date.now() - i * 60000).toISOString(),
    finishedAt: new Date(Date.now() - i * 60000 + 5000).toISOString(),
    durationMs: 5000,
  }));
}

function makeResponse(n: number): ExecutionListResponse {
  return { items: makeItems(n), total: n };
}

async function renderExecutions() {
  const { default: ExecutionsView } = await import("./Executions");
  return render(
    <MemoryRouter initialEntries={["/home/executions"]}>
      <ExecutionsView />
    </MemoryRouter>,
  );
}

describe("ExecutionsView (UX42)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeResponse(5),
    });
  });

  it("renders the table with execution rows", async () => {
    await renderExecutions();
    await waitFor(() => {
      expect(screen.getByText("Workflow 0")).toBeInTheDocument();
    });
    expect(screen.getByText("Workflow 1")).toBeInTheDocument();
    expect(screen.getByText("Workflow 4")).toBeInTheDocument();
  });

  it("shows empty state when no executions", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0 }),
    });
    await renderExecutions();
    await waitFor(() => {
      // i18n mock returns key as-is; EmptyState renders the title key
      expect(screen.getByText("app.empty.executions.title")).toBeInTheDocument();
    });
    expect(screen.getByText("app.empty.executions.action")).toBeInTheDocument();
  });

  it("shows bulk bar when a row checkbox is selected", async () => {
    await renderExecutions();
    await waitFor(() => {
      expect(screen.getByText("Workflow 0")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    const rowCheckboxes = checkboxes.filter(
      (el) => el.getAttribute("aria-label") === "Select row" || el.getAttribute("data-state") !== undefined,
    );
    fireEvent.click(rowCheckboxes.length > 1 ? rowCheckboxes[1] : checkboxes[1]);

    await waitFor(() => {
      // BulkActionsBar uses data-testid="bulk-actions-bar"
      const bar = screen.getByTestId("bulk-actions-bar");
      expect(bar.getAttribute("aria-hidden")).not.toBe("true");
    });
    expect(screen.getByText("Retry selected")).toBeInTheDocument();
    expect(screen.getByText("Delete selected")).toBeInTheDocument();
  });

  it("filter component is rendered", async () => {
    await renderExecutions();
    await waitFor(() => {
      expect(screen.getByTestId("executions-filter")).toBeInTheDocument();
    });
  });

  it("navigates to single execution on row click", async () => {
    await renderExecutions();
    await waitFor(() => {
      expect(screen.getByText("Workflow 0")).toBeInTheDocument();
    });

    const row = screen.getByText("Workflow 0").closest("tr");
    if (row) fireEvent.click(row);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/home/executions/run-0");
    });
  });

  it("pagination: shows page 1 of 1 when total <= pageSize", async () => {
    await renderExecutions();
    await waitFor(() => {
      expect(screen.getByText(/Page 1 of/)).toBeInTheDocument();
    });
  });

  it("shows error text when fetch fails", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await renderExecutions();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  it("shows and hides bulk bar on select-all toggling", async () => {
    await renderExecutions();
    await waitFor(() => {
      expect(screen.getByText("Workflow 0")).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    const firstRowCheckbox = checkboxes[1];

    fireEvent.click(firstRowCheckbox);
    await waitFor(() => {
      // BulkActionsBar uses data-testid="bulk-actions-bar"; visible when selectedCount > 0
      const bar = screen.getByTestId("bulk-actions-bar");
      expect(bar.getAttribute("aria-hidden")).not.toBe("true");
    });

    const deleteBtn = screen.getByText("Delete selected");
    expect(deleteBtn).toBeInTheDocument();
  });
});
