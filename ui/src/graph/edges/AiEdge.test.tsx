// Copyright GraphCaster. All Rights Reserved.

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@xyflow/react");
  return {
    ...actual,
    EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <div data-testid="edge-label-renderer">{children}</div>,
    BaseEdge: ({ id }: { id: string }) => <path data-testid={`base-edge-${id}`} />,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { AI_EDGE_TYPES, AiEdge, aiEdgeI18nKey, aiEdgeTokenSlug } from "./AiEdge";

describe("aiEdgeTokenSlug", () => {
  it("maps every ai edge type to the documented slug", () => {
    expect(aiEdgeTokenSlug("ai_tool")).toBe("tool");
    expect(aiEdgeTokenSlug("ai_memory")).toBe("memory");
    expect(aiEdgeTokenSlug("ai_languageModel")).toBe("model");
    expect(aiEdgeTokenSlug("ai_outputParser")).toBe("parser");
    expect(aiEdgeTokenSlug("ai_embedding")).toBe("embed");
    expect(aiEdgeTokenSlug("ai_chain")).toBe("chain");
    expect(aiEdgeTokenSlug("ai_document")).toBe("doc");
  });
});

describe("aiEdgeI18nKey", () => {
  it("uses the canvas.edge.label.{slug} namespace", () => {
    expect(aiEdgeI18nKey("ai_tool")).toBe("app.canvas.edge.label.tool");
    expect(aiEdgeI18nKey("ai_embedding")).toBe("app.canvas.edge.label.embedding");
    expect(aiEdgeI18nKey("ai_document")).toBe("app.canvas.edge.label.document");
    expect(aiEdgeI18nKey("ai_languageModel")).toBe("app.canvas.edge.label.model");
  });
});

describe("AI_EDGE_TYPES", () => {
  it("contains the seven documented entries", () => {
    expect(AI_EDGE_TYPES).toHaveLength(7);
  });
});

describe("AiEdge", () => {
  function renderEdge(dataType: string) {
    return render(
      <svg>
        <AiEdge
          id="e1"
          source="a"
          target="b"
          sourceX={0}
          sourceY={0}
          targetX={100}
          targetY={50}
          data={{ type: dataType }}
        />
      </svg>,
    );
  }

  it("renders a per-type badge with the i18n key as label text", () => {
    renderEdge("ai_tool");
    expect(screen.getByTestId("gc-ai-edge-label-ai_tool")).toBeInTheDocument();
    expect(screen.getByText("app.canvas.edge.label.tool")).toBeInTheDocument();
  });

  it("falls back to ai_tool when data.type is unrecognized", () => {
    renderEdge("not_an_ai_kind");
    expect(screen.getByTestId("gc-ai-edge-label-ai_tool")).toBeInTheDocument();
  });
});
