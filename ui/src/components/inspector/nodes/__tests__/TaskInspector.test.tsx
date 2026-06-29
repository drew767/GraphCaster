// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { GraphDocumentJson, GraphNodeJson } from "../../../../graph/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const { TaskInspector } = await import("../TaskInspector");

function makeDoc(): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId: "g-1" },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
  };
}

function makeNode(data: Record<string, unknown> = {}): GraphNodeJson {
  return { id: "task-1", type: "task", position: { x: 0, y: 0 }, data };
}

describe("TaskInspector", () => {
  it("renders the cursor-agent toggle without crashing", () => {
    render(
      <TaskInspector
        node={makeNode()}
        graphDocument={makeDoc()}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={() => {}}
      />,
    );
    expect(screen.getByText("app.inspector.cursorAgentHeading")).toBeDefined();
    expect(screen.getByText("app.inspector.cursorAgentEnabled")).toBeDefined();
  });

  it("enabling cursor-agent reveals the prompt textarea", () => {
    render(
      <TaskInspector
        node={makeNode({ gcCursorAgent: { prompt: "hi" } })}
        graphDocument={makeDoc()}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={() => {}}
      />,
    );
    const promptArea = screen.getByLabelText("app.inspector.cursorAgentPrompt") as HTMLTextAreaElement;
    expect(promptArea.value).toBe("hi");
  });

  it("calls onApplyNodeData on Apply when disabled state", () => {
    const onApply = vi.fn();
    render(
      <TaskInspector
        node={makeNode({ gcCursorAgent: { prompt: "p" } })}
        graphDocument={makeDoc()}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={onApply}
      />,
    );
    const button = screen.getByText("app.inspector.applyData");
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalled();
    expect(onApply.mock.calls[0][0]).toBe("task-1");
  });
});
