// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  DraggableKey,
  MAPPING_MIME,
  buildExpressionFromMapping,
} from "../DraggableKey";

function fakeDataTransfer() {
  const store: Record<string, string> = {};
  return {
    setData: vi.fn((type: string, data: string) => {
      store[type] = data;
    }),
    getData: vi.fn((type: string) => store[type] ?? ""),
    effectAllowed: "" as DataTransfer["effectAllowed"],
    dropEffect: "" as DataTransfer["dropEffect"],
    types: Object.keys(store),
    _store: store,
  };
}

describe("DraggableKey", () => {
  it("sets MAPPING_MIME payload with path and sourceNodeName on dragstart", () => {
    render(
      <DraggableKey path="data.user.email" sourceNodeName="Fetch User">
        <span>email</span>
      </DraggableKey>,
    );

    const node = screen.getByTestId("draggable-key-data.user.email");
    const dt = fakeDataTransfer();
    const dragEvent = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(dragEvent, "dataTransfer", { value: dt });

    node.dispatchEvent(dragEvent);

    expect(dt.setData).toHaveBeenCalledWith(
      MAPPING_MIME,
      JSON.stringify({ path: "data.user.email", sourceNodeName: "Fetch User" }),
    );
    expect(dt.effectAllowed).toBe("copy");
  });

  it("buildExpressionFromMapping builds n8n-style expression", () => {
    const expr = buildExpressionFromMapping({
      path: "data.user.email",
      sourceNodeName: "Fetch User",
    });
    expect(expr).toBe("{{ $('Fetch User').item.json.data.user.email }}");
  });

  it("renders children verbatim", () => {
    render(
      <DraggableKey path="foo" sourceNodeName="N">
        <span>my-key</span>
      </DraggableKey>,
    );
    expect(screen.getByText("my-key")).toBeInTheDocument();
  });
});
