// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  applyNodeStateToggle,
  countNodeStates,
  readNodeState,
  toggleNodeStateBypassed,
  toggleNodeStateMuted,
  toggleNodeStatePinned,
} from "../nodeStates";
import { graphDocumentToFlow } from "../toReactFlow";
import type { GraphDocumentJson } from "../types";

function makeDoc(nodeData: Record<string, unknown> = {}): GraphDocumentJson {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "a", type: "task", position: { x: 100, y: 0 }, data: { title: "A", ...nodeData } },
    ],
    edges: [],
  };
}

describe("nodeStates: toggleNodeStateMuted", () => {
  it("sets muted=true when not set", () => {
    const result = toggleNodeStateMuted({});
    expect(result.muted).toBe(true);
  });

  it("removes muted when already true", () => {
    const result = toggleNodeStateMuted({ muted: true });
    expect("muted" in result).toBe(false);
  });

  it("does not modify other fields", () => {
    const result = toggleNodeStateMuted({ title: "X", stepCache: true });
    expect(result.title).toBe("X");
    expect(result.stepCache).toBe(true);
    expect(result.muted).toBe(true);
  });
});

describe("nodeStates: toggleNodeStateBypassed", () => {
  it("sets bypassed=true when not set", () => {
    const result = toggleNodeStateBypassed({});
    expect(result.bypassed).toBe(true);
  });

  it("removes bypassed when already true", () => {
    const result = toggleNodeStateBypassed({ bypassed: true });
    expect("bypassed" in result).toBe(false);
  });
});

describe("nodeStates: toggleNodeStatePinned", () => {
  it("sets pinned=true when not set", () => {
    const result = toggleNodeStatePinned({});
    expect(result.pinned).toBe(true);
  });

  it("removes pinned when already true", () => {
    const result = toggleNodeStatePinned({ pinned: true });
    expect("pinned" in result).toBe(false);
  });
});

describe("nodeStates: readNodeState", () => {
  it("returns all false for empty data", () => {
    const state = readNodeState({});
    expect(state.muted).toBe(false);
    expect(state.bypassed).toBe(false);
    expect(state.pinned).toBe(false);
  });

  it("reads all true correctly", () => {
    const state = readNodeState({ muted: true, bypassed: true, pinned: true });
    expect(state.muted).toBe(true);
    expect(state.bypassed).toBe(true);
    expect(state.pinned).toBe(true);
  });
});

describe("nodeStates: applyNodeStateToggle", () => {
  it("toggles muted on selected nodes only", () => {
    const nodes = [
      { id: "a", data: {} },
      { id: "b", data: {} },
    ];
    const result = applyNodeStateToggle(nodes, new Set(["a"]), "muted");
    expect(result.find((n) => n.id === "a")?.data?.muted).toBe(true);
    expect(result.find((n) => n.id === "b")?.data?.muted).toBeUndefined();
  });

  it("toggles bypassed off when already set", () => {
    const nodes = [{ id: "a", data: { bypassed: true } }];
    const result = applyNodeStateToggle(nodes, new Set(["a"]), "bypassed");
    expect("bypassed" in (result[0]?.data ?? {})).toBe(false);
  });

  it("toggles pinned on multiple nodes", () => {
    const nodes = [
      { id: "a", data: {} },
      { id: "b", data: {} },
    ];
    const result = applyNodeStateToggle(nodes, new Set(["a", "b"]), "pinned");
    expect(result.find((n) => n.id === "a")?.data?.pinned).toBe(true);
    expect(result.find((n) => n.id === "b")?.data?.pinned).toBe(true);
  });
});

describe("nodeStates: countNodeStates", () => {
  it("returns zeros for empty list", () => {
    const { muted, bypassed } = countNodeStates([]);
    expect(muted).toBe(0);
    expect(bypassed).toBe(0);
  });

  it("counts muted and bypassed correctly", () => {
    const nodes = [
      { data: { muted: true } },
      { data: { bypassed: true } },
      { data: { muted: true, bypassed: true } },
      { data: {} },
    ];
    const { muted, bypassed } = countNodeStates(nodes);
    expect(muted).toBe(2);
    expect(bypassed).toBe(2);
  });

  it("ignores nodes with no data", () => {
    const nodes = [{ data: undefined }, {}];
    const { muted, bypassed } = countNodeStates(nodes as { data?: Record<string, unknown> }[]);
    expect(muted).toBe(0);
    expect(bypassed).toBe(0);
  });
});

describe("nodeStates: persistence round-trip via graphDocumentToFlow", () => {
  it("muted=true in node data flows through to GcNodeData.gcMuted", () => {
    const doc = makeDoc({ muted: true });
    const { nodes } = graphDocumentToFlow(doc);
    const node = nodes.find((n) => n.id === "a");
    expect(node?.data?.gcMuted).toBe(true);
    expect(node?.data?.gcBypassed).toBe(false);
    expect(node?.data?.gcPinned).toBe(false);
  });

  it("bypassed=true in node data flows through to GcNodeData.gcBypassed", () => {
    const doc = makeDoc({ bypassed: true });
    const { nodes } = graphDocumentToFlow(doc);
    const node = nodes.find((n) => n.id === "a");
    expect(node?.data?.gcBypassed).toBe(true);
  });

  it("pinned=true results in draggable=false on the React Flow node", () => {
    const doc = makeDoc({ pinned: true });
    const { nodes } = graphDocumentToFlow(doc);
    const node = nodes.find((n) => n.id === "a");
    expect(node?.data?.gcPinned).toBe(true);
    expect(node?.draggable).toBe(false);
  });

  it("non-pinned node has draggable=undefined", () => {
    const doc = makeDoc({});
    const { nodes } = graphDocumentToFlow(doc);
    const node = nodes.find((n) => n.id === "a");
    expect(node?.draggable).toBeUndefined();
  });

  it("state fields survive JSON serialization round-trip", () => {
    const original: GraphDocumentJson = {
      schemaVersion: 1,
      nodes: [
        { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
        {
          id: "a",
          type: "task",
          position: { x: 100, y: 0 },
          data: { title: "A", muted: true, bypassed: false, pinned: true },
        },
      ],
      edges: [],
    };
    const serialized = JSON.stringify(original);
    const restored = JSON.parse(serialized) as GraphDocumentJson;
    const nodeA = restored.nodes?.find((n) => n.id === "a");
    expect(nodeA?.data?.muted).toBe(true);
    expect(nodeA?.data?.pinned).toBe(true);
    expect(nodeA?.data?.bypassed).toBe(false);
  });
});
