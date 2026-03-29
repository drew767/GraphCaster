// Copyright Aura. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock i18n - must be before importing the component
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "app.canvas.addNodeTitle": "Add node",
        "app.canvas.nodePaletteToggle": "Toggle node palette",
        "app.canvas.addNodeFilterPh": "Filter by type…",
        "app.canvas.nodeTypes.start": "Start",
        "app.canvas.nodeTypes.exit": "Exit",
        "app.canvas.nodeTypes.task": "Task",
        "app.canvas.nodeTypes.ai_route": "AI route",
        "app.canvas.nodeTypes.mcp_tool": "MCP tool",
        "app.canvas.nodeTypes.llm_agent": "LLM agent",
        "app.canvas.nodeTypes.merge": "Merge",
        "app.canvas.nodeTypes.fork": "Fork",
        "app.canvas.nodeTypes.comment": "Comment frame",
        "app.canvas.nodeTypes.group": "Group frame",
        "app.canvas.addNodeCategory.all": "All",
        "app.canvas.addNodeCategory.flow": "Flow",
        "app.canvas.addNodeCategory.steps": "Run & AI",
        "app.canvas.addNodeCategory.nested": "Nested",
        "app.canvas.addNodeCategory.notes": "Notes",
      };
      return translations[key] ?? key;
    },
  }),
}));

import { NodePaletteSidebar } from "./NodePaletteSidebar";

describe("NodePaletteSidebar", () => {
  const defaultProps = {
    isOpen: true,
    onToggle: vi.fn(),
    hasStartNode: false,
    onNodeClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with title when open", () => {
    render(<NodePaletteSidebar {...defaultProps} />);
    expect(screen.getByText("Add node")).toBeInTheDocument();
  });

  it("is collapsed when isOpen is false", () => {
    render(<NodePaletteSidebar {...defaultProps} isOpen={false} />);
    expect(screen.queryByText("Add node")).not.toBeInTheDocument();
  });

  it("calls onToggle when toggle button clicked", () => {
    const onToggle = vi.fn();
    render(<NodePaletteSidebar {...defaultProps} onToggle={onToggle} />);
    const toggleBtn = screen.getByRole("button", { name: /toggle node palette/i });
    fireEvent.click(toggleBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders all node types when no filter", () => {
    render(<NodePaletteSidebar {...defaultProps} />);
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Exit")).toBeInTheDocument();
    expect(screen.getByText("Task")).toBeInTheDocument();
  });

  it("hides start node type when hasStartNode is true", () => {
    render(<NodePaletteSidebar {...defaultProps} hasStartNode={true} />);
    expect(screen.queryByText("Start")).not.toBeInTheDocument();
    expect(screen.getByText("Exit")).toBeInTheDocument();
  });

  it("filters nodes when search text entered", () => {
    render(<NodePaletteSidebar {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText("Filter by type…");
    fireEvent.change(searchInput, { target: { value: "task" } });
    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(screen.queryByText("Start")).not.toBeInTheDocument();
  });

  it("calls onNodeClick when node item clicked", () => {
    const onNodeClick = vi.fn();
    render(<NodePaletteSidebar {...defaultProps} onNodeClick={onNodeClick} />);
    fireEvent.click(screen.getByText("Task"));
    expect(onNodeClick).toHaveBeenCalledWith({ kind: "primitive", nodeType: "task" });
  });

  it("renders category tabs", () => {
    render(<NodePaletteSidebar {...defaultProps} />);
    expect(screen.getByRole("tab", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Flow" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Run & AI" })).toBeInTheDocument();
  });

  it("filters by category when category tab clicked", () => {
    render(<NodePaletteSidebar {...defaultProps} />);
    fireEvent.click(screen.getByRole("tab", { name: "Flow" }));
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Exit")).toBeInTheDocument();
    expect(screen.queryByText("Task")).not.toBeInTheDocument();
  });

  it("has accessible sidebar landmark", () => {
    render(<NodePaletteSidebar {...defaultProps} />);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });
});
