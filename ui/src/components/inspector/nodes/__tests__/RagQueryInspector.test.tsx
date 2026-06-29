// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { GraphDocumentJson, GraphNodeJson } from "../../../../graph/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { RagQueryInspector } = await import("../RagQueryInspector");

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
  return { id: "rag-1", type: "rag_query", position: { x: 0, y: 0 }, data };
}

describe("RagQueryInspector", () => {
  it("renders default http vectorBackend", () => {
    render(
      <RagQueryInspector
        node={makeNode()}
        graphDocument={makeDoc()}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={() => {}}
      />,
    );
    const vb = screen.getByLabelText("app.inspector.ragQueryVectorBackend") as HTMLSelectElement;
    expect(vb.value).toBe("http");
  });

  it("memory backend strips http-only fields on apply", () => {
    const onApply = vi.fn();
    render(
      <RagQueryInspector
        node={makeNode({ vectorBackend: "memory", query: "hi", url: "https://x" })}
        graphDocument={makeDoc()}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={onApply}
      />,
    );
    fireEvent.click(screen.getByText("app.inspector.applyRagQuerySettings"));
    expect(onApply).toHaveBeenCalled();
    const payload = onApply.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.vectorBackend).toBe("memory");
    expect(payload.url).toBeUndefined();
  });
});
