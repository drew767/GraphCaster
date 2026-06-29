// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { GraphDocumentJson, GraphNodeJson } from "../../../../graph/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { McpToolInspector } = await import("../McpToolInspector");

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
  return { id: "mcp-1", type: "mcp_tool", position: { x: 0, y: 0 }, data };
}

describe("McpToolInspector", () => {
  it("renders without crash, default transport is stdio", () => {
    render(
      <McpToolInspector
        node={makeNode()}
        graphDocument={makeDoc()}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={() => {}}
      />,
    );
    const sel = screen.getByLabelText("app.inspector.mcpTransport") as HTMLSelectElement;
    expect(sel.value).toBe("stdio");
  });

  it("Apply with valid args object calls onApplyNodeData", () => {
    const onApply = vi.fn();
    render(
      <McpToolInspector
        node={makeNode({ toolName: "echo", arguments: { x: 1 } })}
        graphDocument={makeDoc()}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={onApply}
      />,
    );
    fireEvent.click(screen.getByText("app.inspector.applyMcpSettings"));
    expect(onApply).toHaveBeenCalled();
    const [id, payload] = onApply.mock.calls[0];
    expect(id).toBe("mcp-1");
    expect((payload as Record<string, unknown>).toolName).toBe("echo");
  });
});
