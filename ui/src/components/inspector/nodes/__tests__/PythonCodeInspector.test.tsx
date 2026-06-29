// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { GraphDocumentJson, GraphNodeJson } from "../../../../graph/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { PythonCodeInspector } = await import("../PythonCodeInspector");

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
  return { id: "py-1", type: "python_code", position: { x: 0, y: 0 }, data };
}

describe("PythonCodeInspector", () => {
  it("renders code textarea with initial value", () => {
    render(
      <PythonCodeInspector
        node={makeNode({ code: "print('x')" })}
        graphDocument={makeDoc()}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={() => {}}
      />,
    );
    const ta = screen.getByLabelText("app.inspector.pythonCodeEditorLabel") as HTMLTextAreaElement;
    expect(ta.value).toBe("print('x')");
  });

  it("Apply emits code+timeout", () => {
    const onApply = vi.fn();
    render(
      <PythonCodeInspector
        node={makeNode({ code: "print(1)", timeoutSec: 5 })}
        graphDocument={makeDoc()}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={onApply}
      />,
    );
    fireEvent.click(screen.getByText("app.inspector.applyPythonCodeSettings"));
    expect(onApply).toHaveBeenCalled();
    const [id, payload] = onApply.mock.calls[0];
    expect(id).toBe("py-1");
    expect((payload as Record<string, unknown>).code).toBe("print(1)");
    expect((payload as Record<string, unknown>).timeoutSec).toBe(5);
  });
});
