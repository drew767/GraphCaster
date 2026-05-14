// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@radix-ui/react-tooltip", () => ({
  Provider: ({ children }: { children: React.ReactNode }) => children,
  Root: ({ children }: { children: React.ReactNode }) => children,
  Trigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => children,
  Portal: ({ children }: { children: React.ReactNode }) => null,
  Content: () => null,
  Arrow: () => null,
}));

vi.mock("../../ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import { CanvasNodeToolbar } from "../CanvasNodeToolbar";

const defaultRect = { top: 200, left: 100, width: 180 };

describe("CanvasNodeToolbar", () => {
  const onRunNode = vi.fn();
  const onToggleDisable = vi.fn();
  const onDelete = vi.fn();
  const onChangeColor = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders toolbar with all core buttons for a regular node", () => {
    render(
      <CanvasNodeToolbar
        nodeId="n1"
        nodeType="task"
        isMuted={false}
        selected={true}
        nodeRect={defaultRect}
        onRunNode={onRunNode}
        onToggleDisable={onToggleDisable}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByLabelText("app.canvas.nodeToolbar.runNode")).toBeInTheDocument();
    expect(screen.getByLabelText("app.canvas.nodeToolbar.disableNode")).toBeInTheDocument();
    expect(screen.getByLabelText("app.canvas.nodeToolbar.deleteNode")).toBeInTheDocument();
  });

  it("is visible when selected=true", () => {
    const { container } = render(
      <CanvasNodeToolbar
        nodeId="n1"
        nodeType="task"
        isMuted={false}
        selected={true}
        nodeRect={defaultRect}
        onRunNode={onRunNode}
        onToggleDisable={onToggleDisable}
        onDelete={onDelete}
      />,
    );
    expect(container.querySelector(".gc-node-toolbar--visible")).not.toBeNull();
  });

  it("is not visible when selected=false and not hovered", () => {
    const { container } = render(
      <CanvasNodeToolbar
        nodeId="n1"
        nodeType="task"
        isMuted={false}
        selected={false}
        nodeRect={defaultRect}
        onRunNode={onRunNode}
        onToggleDisable={onToggleDisable}
        onDelete={onDelete}
      />,
    );
    expect(container.querySelector(".gc-node-toolbar--visible")).toBeNull();
  });

  it("calls onRunNode with nodeId when run button clicked", () => {
    render(
      <CanvasNodeToolbar
        nodeId="node-abc"
        nodeType="task"
        isMuted={false}
        selected={true}
        nodeRect={defaultRect}
        onRunNode={onRunNode}
        onToggleDisable={onToggleDisable}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByLabelText("app.canvas.nodeToolbar.runNode"));
    expect(onRunNode).toHaveBeenCalledWith("node-abc");
  });

  it("calls onToggleDisable with nodeId when power button clicked", () => {
    render(
      <CanvasNodeToolbar
        nodeId="node-abc"
        nodeType="task"
        isMuted={false}
        selected={true}
        nodeRect={defaultRect}
        onRunNode={onRunNode}
        onToggleDisable={onToggleDisable}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByLabelText("app.canvas.nodeToolbar.disableNode"));
    expect(onToggleDisable).toHaveBeenCalledWith("node-abc");
  });

  it("shows aria-pressed=true and enableNode label when isMuted=true", () => {
    render(
      <CanvasNodeToolbar
        nodeId="n1"
        nodeType="task"
        isMuted={true}
        selected={true}
        nodeRect={defaultRect}
        onRunNode={onRunNode}
        onToggleDisable={onToggleDisable}
        onDelete={onDelete}
      />,
    );
    const btn = screen.getByLabelText("app.canvas.nodeToolbar.enableNode");
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onDelete with nodeId when delete button clicked", () => {
    render(
      <CanvasNodeToolbar
        nodeId="node-del"
        nodeType="task"
        isMuted={false}
        selected={true}
        nodeRect={defaultRect}
        onRunNode={onRunNode}
        onToggleDisable={onToggleDisable}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByLabelText("app.canvas.nodeToolbar.deleteNode"));
    expect(onDelete).toHaveBeenCalledWith("node-del");
  });

  it("shows changeColor button only for comment/group nodes", () => {
    const { rerender } = render(
      <CanvasNodeToolbar
        nodeId="n1"
        nodeType="task"
        isMuted={false}
        selected={true}
        nodeRect={defaultRect}
        onRunNode={onRunNode}
        onToggleDisable={onToggleDisable}
        onDelete={onDelete}
        onChangeColor={onChangeColor}
      />,
    );
    expect(screen.queryByLabelText("app.canvas.nodeToolbar.changeColor")).toBeNull();

    rerender(
      <CanvasNodeToolbar
        nodeId="n1"
        nodeType="comment"
        isMuted={false}
        selected={true}
        nodeRect={defaultRect}
        onRunNode={onRunNode}
        onToggleDisable={onToggleDisable}
        onDelete={onDelete}
        onChangeColor={onChangeColor}
      />,
    );
    expect(screen.getByLabelText("app.canvas.nodeToolbar.changeColor")).toBeInTheDocument();
  });
});
