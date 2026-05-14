// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { edgeConnectionTypeStrokeToken, graphDocumentToFlow } from "./toReactFlow";
import type { GraphDocumentJson } from "./types";

function makeDoc(): GraphDocumentJson {
  return {
    nodes: [
      { id: "a", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "b", type: "task", position: { x: 100, y: 0 }, data: {} },
      { id: "c", type: "task", position: { x: 200, y: 0 }, data: {} },
    ],
    edges: [
      {
        id: "e_main",
        source: "a",
        target: "b",
        sourceHandle: "out_default",
        targetHandle: "in_default",
      },
      {
        id: "e_tool",
        source: "a",
        target: "c",
        sourceHandle: "out_default",
        targetHandle: "in_default",
        data: { type: "ai_tool" },
      },
      {
        id: "e_memory",
        source: "b",
        target: "c",
        sourceHandle: "out_default",
        targetHandle: "in_default",
        data: { type: "ai_memory" },
      },
      {
        id: "e_lm",
        source: "b",
        target: "c",
        sourceHandle: "out_default",
        targetHandle: "in_default",
        data: { type: "ai_languageModel" },
      },
    ],
  };
}

describe("graphDocumentToFlow run-edge animation", () => {
  it("marks edges in currentRunningEdges as animated with running class", () => {
    const doc = makeDoc();
    const running = new Set(["e_main"]);
    const { edges } = graphDocumentToFlow(doc, { currentRunningEdges: running });
    const eMain = edges.find((e) => e.id === "e_main")!;
    expect(eMain.animated).toBe(true);
    expect(eMain.className).toBe("gc-edge--running");

    const eOther = edges.find((e) => e.id === "e_tool")!;
    expect(eOther.animated).toBeFalsy();
    expect(eOther.className).toBe("");
  });

  it("omits animation when no running set is provided", () => {
    const doc = makeDoc();
    const { edges } = graphDocumentToFlow(doc);
    for (const e of edges) {
      expect(e.animated).toBeFalsy();
      expect(e.className).toBe("");
    }
  });
});

describe("graphDocumentToFlow connection-type color coding", () => {
  it("uses the main stroke token when type is missing or 'main'", () => {
    const doc = makeDoc();
    const { edges } = graphDocumentToFlow(doc);
    const eMain = edges.find((e) => e.id === "e_main")!;
    expect((eMain.style as { stroke?: string })?.stroke).toBe(
      edgeConnectionTypeStrokeToken("main"),
    );
    expect(edgeConnectionTypeStrokeToken("main")).toBe("var(--color--edge-main)");
  });

  it("uses ai_tool stroke token for ai_tool edges", () => {
    const doc = makeDoc();
    const { edges } = graphDocumentToFlow(doc);
    const e = edges.find((x) => x.id === "e_tool")!;
    expect((e.style as { stroke?: string })?.stroke).toBe(
      edgeConnectionTypeStrokeToken("ai_tool"),
    );
    expect(edgeConnectionTypeStrokeToken("ai_tool")).toBe("var(--color--edge-ai-tool)");
  });

  it("uses ai_memory stroke token for ai_memory edges", () => {
    const doc = makeDoc();
    const { edges } = graphDocumentToFlow(doc);
    const e = edges.find((x) => x.id === "e_memory")!;
    expect((e.style as { stroke?: string })?.stroke).toBe(
      edgeConnectionTypeStrokeToken("ai_memory"),
    );
    expect(edgeConnectionTypeStrokeToken("ai_memory")).toBe("var(--color--edge-ai-memory)");
  });

  it("uses ai_languageModel stroke token for ai_languageModel edges", () => {
    const doc = makeDoc();
    const { edges } = graphDocumentToFlow(doc);
    const e = edges.find((x) => x.id === "e_lm")!;
    expect((e.style as { stroke?: string })?.stroke).toBe(
      edgeConnectionTypeStrokeToken("ai_languageModel"),
    );
    expect(edgeConnectionTypeStrokeToken("ai_languageModel")).toBe(
      "var(--color--edge-ai-language-model)",
    );
  });

  it("falls back to main when type is unknown / invalid", () => {
    const doc: GraphDocumentJson = {
      nodes: [
        { id: "a", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "b", type: "task", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e_bad",
          source: "a",
          target: "b",
          sourceHandle: "out_default",
          targetHandle: "in_default",
          data: { type: "definitely-not-a-type" as unknown as "ai_tool" },
        },
      ],
    };
    const { edges } = graphDocumentToFlow(doc);
    expect((edges[0]!.style as { stroke?: string })?.stroke).toBe(
      edgeConnectionTypeStrokeToken("main"),
    );
  });
});
