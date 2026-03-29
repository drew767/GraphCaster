// Copyright Aura. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DraggableNodeItem } from "./DraggableNodeItem";
import { GC_DRAG_NODE_MIME_TYPE } from "../graph/nodeDragDrop";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("DraggableNodeItem", () => {
  it("renders node type and label", () => {
    render(
      <DraggableNodeItem
        nodeType="task"
        label="Task Node"
        payload={{ kind: "primitive", nodeType: "task" }}
      />
    );
    expect(screen.getByText("task")).toBeInTheDocument();
    expect(screen.getByText("Task Node")).toBeInTheDocument();
  });

  it("is draggable", () => {
    render(
      <DraggableNodeItem
        nodeType="task"
        label="Task Node"
        payload={{ kind: "primitive", nodeType: "task" }}
      />
    );
    const item = screen.getByRole("listitem");
    expect(item).toHaveAttribute("draggable", "true");
  });

  it("sets correct data on dragstart", () => {
    render(
      <DraggableNodeItem
        nodeType="task"
        label="Task Node"
        payload={{ kind: "primitive", nodeType: "task" }}
      />
    );
    const item = screen.getByRole("listitem");
    
    const setData = vi.fn();
    const setDragImage = vi.fn();
    const mockDataTransfer = {
      setData,
      setDragImage,
      effectAllowed: "",
    };

    fireEvent.dragStart(item, { dataTransfer: mockDataTransfer });

    expect(setData).toHaveBeenCalledWith(
      GC_DRAG_NODE_MIME_TYPE,
      expect.stringContaining('"kind":"primitive"')
    );
    expect(mockDataTransfer.effectAllowed).toBe("copy");
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(
      <DraggableNodeItem
        nodeType="task"
        label="Task Node"
        payload={{ kind: "primitive", nodeType: "task" }}
        onClick={onClick}
      />
    );
    const item = screen.getByRole("listitem");
    fireEvent.click(item);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("activates on Enter key press", () => {
    const onClick = vi.fn();
    render(
      <DraggableNodeItem
        nodeType="task"
        label="Task Node"
        payload={{ kind: "primitive", nodeType: "task" }}
        onClick={onClick}
      />
    );
    const item = screen.getByRole("listitem");
    fireEvent.keyDown(item, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("activates on Space key press", () => {
    const onClick = vi.fn();
    render(
      <DraggableNodeItem
        nodeType="task"
        label="Task Node"
        payload={{ kind: "primitive", nodeType: "task" }}
        onClick={onClick}
      />
    );
    const item = screen.getByRole("listitem");
    fireEvent.keyDown(item, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
