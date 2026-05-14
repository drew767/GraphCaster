// Copyright GraphCaster. All Rights Reserved.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BulkActionsBar, type BulkAction } from "./BulkActionsBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback ?? key;
      let str = fallback ?? key;
      for (const [k, v] of Object.entries(opts)) {
        str = str.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
      }
      return str;
    },
  }),
}));

const actions: BulkAction[] = [
  { id: "retry", label: "Retry", onClick: vi.fn() },
  { id: "delete", label: "Delete", onClick: vi.fn(), destructive: true },
];

describe("BulkActionsBar", () => {
  it("renders selected count label", () => {
    render(
      <BulkActionsBar
        selectedCount={3}
        actions={actions}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("is hidden when selectedCount is 0", () => {
    render(
      <BulkActionsBar
        selectedCount={0}
        actions={actions}
        onClearSelection={vi.fn()}
      />,
    );
    const bar = screen.getByTestId("bulk-actions-bar");
    expect(bar).toHaveClass("gc-bulk-bar--hidden");
  });

  it("is visible when selectedCount > 0", () => {
    render(
      <BulkActionsBar
        selectedCount={2}
        actions={actions}
        onClearSelection={vi.fn()}
      />,
    );
    const bar = screen.getByTestId("bulk-actions-bar");
    expect(bar).toHaveClass("gc-bulk-bar--visible");
  });

  it("calls action onClick when action button clicked", () => {
    const retryFn = vi.fn();
    const localActions: BulkAction[] = [
      { id: "retry", label: "Retry", onClick: retryFn },
    ];
    render(
      <BulkActionsBar
        selectedCount={2}
        actions={localActions}
        onClearSelection={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryFn).toHaveBeenCalledTimes(1);
  });

  it("calls onClearSelection when clear button clicked", () => {
    const clearFn = vi.fn();
    render(
      <BulkActionsBar
        selectedCount={2}
        actions={actions}
        onClearSelection={clearFn}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(clearFn).toHaveBeenCalledTimes(1);
  });

  it("renders selectedOfTotal label when totalCount provided", () => {
    render(
      <BulkActionsBar
        selectedCount={3}
        totalCount={10}
        actions={actions}
        onClearSelection={vi.fn()}
      />,
    );
    expect(screen.getByText("3 of 10 selected")).toBeInTheDocument();
  });
});
