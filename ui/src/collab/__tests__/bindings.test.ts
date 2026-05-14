// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { GraphStoreBridge } from "../bindings";
import { bindCollabToStore } from "../bindings";
import type { CollabProvider } from "../yjs_provider";

function makeProvider(): CollabProvider {
  const doc = new Y.Doc();
  return {
    doc,
    graphId: "test",
    ws: null,
    awareness: {
      clientId: doc.clientID,
      states: new Map(),
      localState: {},
      listeners: new Set(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    setLocalAwareness: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as CollabProvider;
}

describe("bindCollabToStore", () => {
  it("returns a storeToY function", () => {
    const provider = makeProvider();
    const bridge: GraphStoreBridge = {
      getSnapshot: () => ({ nodes: [], edges: [] }),
      applyRemote: vi.fn(),
    };
    const storeToY = bindCollabToStore(provider, bridge);
    expect(typeof storeToY).toBe("function");
  });

  it("Y.Map changes trigger applyRemote", () => {
    const provider = makeProvider();
    const applyRemote = vi.fn();
    const bridge: GraphStoreBridge = {
      getSnapshot: () => ({ nodes: [], edges: [] }),
      applyRemote,
    };
    bindCollabToStore(provider, bridge);

    provider.doc.getMap("nodes").set("n1", { id: "n1", type: "llm" } as unknown as Record<string, unknown>);

    expect(applyRemote).toHaveBeenCalled();
    const call = applyRemote.mock.calls[0][0] as { nodes: unknown[]; edges: unknown[] };
    expect(call.nodes).toHaveLength(1);
    expect((call.nodes[0] as { id: string }).id).toBe("n1");
  });

  it("storeToY writes nodes and edges into Y.Map", () => {
    const provider = makeProvider();
    const bridge: GraphStoreBridge = {
      getSnapshot: () => ({ nodes: [], edges: [] }),
      applyRemote: vi.fn(),
    };
    const storeToY = bindCollabToStore(provider, bridge);

    storeToY({
      nodes: [{ id: "n2", type: "code" }],
      edges: [{ id: "e1", source: "n2", target: "n3" }],
    });

    expect(provider.doc.getMap("nodes").get("n2")).toMatchObject({ id: "n2" });
    expect(provider.doc.getMap("edges").get("e1")).toMatchObject({ id: "e1" });
  });

  it("storeToY removes deleted nodes from Y.Map", () => {
    const provider = makeProvider();
    provider.doc.getMap("nodes").set("old", { id: "old" } as unknown as Record<string, unknown>);

    const bridge: GraphStoreBridge = {
      getSnapshot: () => ({ nodes: [], edges: [] }),
      applyRemote: vi.fn(),
    };
    const storeToY = bindCollabToStore(provider, bridge);

    storeToY({ nodes: [], edges: [] });
    expect(provider.doc.getMap("nodes").has("old")).toBe(false);
  });
});
