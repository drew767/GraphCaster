// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { NodeSearchPopover } from "./NodeSearchPopover";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => {
      if (key === "nodeSearch.placeholder") return "Search nodes…";
      if (key === "nodeSearch.empty") return "No matching nodes";
      if (key === "nodeSearch.dialogLabel") return "Add node";
      if (key.startsWith("nodeSearch.category.")) {
        return key.slice("nodeSearch.category.".length);
      }
      if (key.startsWith("app.canvas.nodeTypes.")) {
        return key.slice("app.canvas.nodeTypes.".length);
      }
      if (key.startsWith("nodeSearch.descriptions.")) {
        return key.slice("nodeSearch.descriptions.".length);
      }
      return opts?.defaultValue ?? key;
    },
  }),
}));

describe("NodeSearchPopover", () => {
  const baseProps = {
    open: true as const,
    anchorPosition: { x: 100, y: 100 },
    onClose: vi.fn(),
    onSelect: vi.fn(),
  };

  it("renders when open is true", () => {
    render(<NodeSearchPopover {...baseProps} />);
    expect(screen.getByRole("dialog", { name: "Add node" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search nodes…")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<NodeSearchPopover {...baseProps} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("filters list when user types", () => {
    render(<NodeSearchPopover {...baseProps} />);
    const input = screen.getByPlaceholderText("Search nodes…") as HTMLInputElement;
    // Before typing: many options visible (start, exit, fork, …)
    expect(screen.getAllByRole("option").length).toBeGreaterThan(3);
    fireEvent.change(input, { target: { value: "http" } });
    const options = screen.getAllByRole("option");
    // After typing "http" we expect only the HTTP request row.
    expect(options.length).toBe(1);
    expect(within(options[0]).getByText("http_request")).toBeInTheDocument();
  });

  it("shows empty state when nothing matches", () => {
    render(<NodeSearchPopover {...baseProps} />);
    const input = screen.getByPlaceholderText("Search nodes…");
    fireEvent.change(input, { target: { value: "xxxxxyyyyzzz" } });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText("No matching nodes")).toBeInTheDocument();
  });

  it("calls onSelect with the node type when item is clicked", () => {
    const onSelect = vi.fn();
    render(<NodeSearchPopover {...baseProps} onSelect={onSelect} />);
    const input = screen.getByPlaceholderText("Search nodes…");
    fireEvent.change(input, { target: { value: "http" } });
    const option = screen.getAllByRole("option")[0];
    const btn = within(option).getByRole("button");
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith("http_request");
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<NodeSearchPopover {...baseProps} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("selects active row when Enter is pressed", () => {
    const onSelect = vi.fn();
    render(<NodeSearchPopover {...baseProps} onSelect={onSelect} />);
    const input = screen.getByPlaceholderText("Search nodes…");
    fireEvent.change(input, { target: { value: "http" } });
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("http_request");
  });

  it("moves active row with arrow keys", () => {
    render(<NodeSearchPopover {...baseProps} />);
    const dialog = screen.getByRole("dialog");
    const firstActive = screen.getAllByRole("option").find((el) => el.getAttribute("aria-selected") === "true");
    expect(firstActive).toBeDefined();
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    const secondActive = screen.getAllByRole("option").find((el) => el.getAttribute("aria-selected") === "true");
    expect(secondActive).toBeDefined();
    expect(secondActive).not.toBe(firstActive);
  });

  it("restricts catalog with filter='trigger'", () => {
    render(<NodeSearchPopover {...baseProps} filter="trigger" />);
    const options = screen.getAllByRole("option");
    const labels = options.map(
      (o) => o.querySelector(".gc-node-search-popover__label")?.textContent ?? "",
    );
    // Only trigger-category rows: start, trigger_webhook, trigger_schedule
    expect(labels).toContain("start");
    expect(labels).toContain("trigger_webhook");
    expect(labels).toContain("trigger_schedule");
    expect(labels).not.toContain("task");
    expect(labels).not.toContain("http_request");
  });

  it("clamps to viewport edges", () => {
    render(
      <NodeSearchPopover
        {...baseProps}
        anchorPosition={{ x: 99999, y: 99999 }}
      />,
    );
    const dialog = screen.getByRole("dialog") as HTMLDivElement;
    const left = parseInt(dialog.style.left, 10);
    const top = parseInt(dialog.style.top, 10);
    expect(Number.isFinite(left)).toBe(true);
    expect(Number.isFinite(top)).toBe(true);
    // Should be clamped to (viewport - popover - margin), not 99999.
    expect(left).toBeLessThan(99999);
    expect(top).toBeLessThan(99999);
  });
});
