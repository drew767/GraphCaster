// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { GraphDocumentJson, GraphNodeJson } from "../../../../graph/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { HttpRequestInspector } = await import("../HttpRequestInspector");

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
  return { id: "http-1", type: "http_request", position: { x: 0, y: 0 }, data };
}

describe("HttpRequestInspector", () => {
  it("renders fields without crashing", () => {
    render(
      <HttpRequestInspector
        node={makeNode({ url: "https://example.com", method: "POST" })}
        graphDocument={makeDoc()}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={() => {}}
      />,
    );
    const url = screen.getByLabelText("app.inspector.httpRequestUrl") as HTMLInputElement;
    expect(url.value).toBe("https://example.com");
    const method = screen.getByLabelText("app.inspector.httpRequestMethod") as HTMLSelectElement;
    expect(method.value).toBe("POST");
  });

  it("Apply invokes callback with merged data", () => {
    const onApply = vi.fn();
    render(
      <HttpRequestInspector
        node={makeNode({ url: "https://example.com" })}
        graphDocument={makeDoc()}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={onApply}
      />,
    );
    fireEvent.click(screen.getByText("app.inspector.applyHttpRequestSettings"));
    expect(onApply).toHaveBeenCalled();
    const [id, payload] = onApply.mock.calls[0];
    expect(id).toBe("http-1");
    expect((payload as Record<string, unknown>).url).toBe("https://example.com");
  });
});
