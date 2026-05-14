// Copyright GraphCaster. All Rights Reserved.

import { act, render } from "@testing-library/react";
import { ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../../toast/ToastProvider";
import {
  buildClipboardPayload,
  parseClipboardPayload,
  remapPayloadForInsert,
  useCanvasClipboard,
  GC_CLIPBOARD_VERSION,
} from "../useCanvasClipboard";

type ClipboardMock = {
  writeText: ReturnType<typeof vi.fn>;
  readText: ReturnType<typeof vi.fn>;
  store: { value: string };
};

function installClipboardMock(): ClipboardMock {
  const store = { value: "" };
  const writeText = vi.fn(async (s: string) => {
    store.value = s;
  });
  const readText = vi.fn(async () => store.value);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText, readText },
  });
  return { writeText, readText, store };
}

function dispatchHotkey(key: string): void {
  const ev = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true });
  window.dispatchEvent(ev);
}

describe("useCanvasClipboard pure helpers", () => {
  it("builds payload with internal edges only", () => {
    const nodes: Node[] = [
      { id: "a", type: "gcNode", position: { x: 0, y: 0 }, data: {}, selected: true },
      { id: "b", type: "gcNode", position: { x: 50, y: 50 }, data: {}, selected: true },
      { id: "c", type: "gcNode", position: { x: 200, y: 0 }, data: {}, selected: false },
    ];
    const edges: Edge[] = [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
    ];
    const payload = buildClipboardPayload(nodes, edges);
    expect(payload.gcVersion).toBe(GC_CLIPBOARD_VERSION);
    expect(payload.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(payload.edges.map((e) => e.id)).toEqual(["ab"]);
  });

  it("parses payload and rejects wrong shapes", () => {
    expect(parseClipboardPayload("not json")).toBeNull();
    expect(parseClipboardPayload(JSON.stringify({}))).toBeNull();
    expect(
      parseClipboardPayload(JSON.stringify({ nodes: [], edges: [], gcVersion: 999 })),
    ).toBeNull();
    const ok = parseClipboardPayload(
      JSON.stringify({ nodes: [], edges: [], gcVersion: GC_CLIPBOARD_VERSION }),
    );
    expect(ok).not.toBeNull();
  });

  it("remaps ids and offsets positions on insert", () => {
    let n = 0;
    const makeId = () => `new-${++n}`;
    const remapped = remapPayloadForInsert(
      {
        nodes: [
          { id: "a", type: "gcNode", position: { x: 10, y: 20 }, data: {} },
          { id: "b", type: "gcNode", position: { x: 100, y: 30 }, data: {} },
        ],
        edges: [{ id: "ab", source: "a", target: "b" }],
        gcVersion: GC_CLIPBOARD_VERSION,
      },
      { x: 40, y: 40 },
      makeId,
    );
    expect(remapped.nodes.map((n) => n.id)).toEqual(["new-1", "new-2"]);
    expect(remapped.nodes[0].position).toEqual({ x: 50, y: 60 });
    expect(remapped.nodes[1].position).toEqual({ x: 140, y: 70 });
    expect(remapped.edges).toHaveLength(1);
    expect(remapped.edges[0].source).toBe("new-1");
    expect(remapped.edges[0].target).toBe("new-2");
    expect(remapped.edges[0].id).toBe("new-3");
  });

  it("duplicate offset applied to all selected nodes", () => {
    const nodes: Node[] = [
      { id: "a", type: "gcNode", position: { x: 0, y: 0 }, data: {}, selected: true },
      { id: "b", type: "gcNode", position: { x: 10, y: 10 }, data: {}, selected: true },
    ];
    const payload = buildClipboardPayload(nodes, []);
    const remapped = remapPayloadForInsert(payload, { x: 40, y: 40 });
    expect(remapped.nodes[0].position).toEqual({ x: 40, y: 40 });
    expect(remapped.nodes[1].position).toEqual({ x: 50, y: 50 });
  });
});

// ---------------------------------------------------------------------------
// Hook integration: copy/paste roundtrip via mocked navigator.clipboard
// ---------------------------------------------------------------------------

function Harness({
  initialNodes,
  initialEdges,
}: {
  initialNodes: Node[];
  initialEdges: Edge[];
}) {
  return (
    <ToastProvider>
      <ReactFlowProvider
        initialNodes={initialNodes}
        initialEdges={initialEdges}
      >
        <ClipboardWiring />
      </ReactFlowProvider>
    </ToastProvider>
  );
}

function ClipboardWiring() {
  useCanvasClipboard();
  return null;
}

describe("useCanvasClipboard hook roundtrip", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("copy then paste writes/reads payload via navigator.clipboard", async () => {
    const clip = installClipboardMock();
    const nodes: Node[] = [
      { id: "a", type: "gcNode", position: { x: 0, y: 0 }, data: {}, selected: true },
      { id: "b", type: "gcNode", position: { x: 50, y: 0 }, data: {}, selected: true },
    ];
    const edges: Edge[] = [{ id: "ab", source: "a", target: "b" }];

    render(<Harness initialNodes={nodes} initialEdges={edges} />);

    await act(async () => {
      dispatchHotkey("c");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clip.writeText).toHaveBeenCalledTimes(1);
    const writtenRaw = clip.writeText.mock.calls[0][0] as string;
    const parsed = parseClipboardPayload(writtenRaw);
    expect(parsed).not.toBeNull();
    expect(parsed!.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(parsed!.edges.map((e) => e.id)).toEqual(["ab"]);

    await act(async () => {
      dispatchHotkey("v");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clip.readText).toHaveBeenCalledTimes(1);
  });

  it("skips when focus is in an input", async () => {
    const clip = installClipboardMock();
    const nodes: Node[] = [
      { id: "a", type: "gcNode", position: { x: 0, y: 0 }, data: {}, selected: true },
    ];
    render(<Harness initialNodes={nodes} initialEdges={[]} />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    await act(async () => {
      const ev = new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        bubbles: true,
      });
      input.dispatchEvent(ev);
      await Promise.resolve();
    });

    expect(clip.writeText).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });
});
