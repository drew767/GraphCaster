// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { NodeProps } from "@xyflow/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const setNodesMock = vi.fn();

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    NodeResizer: ({ isVisible }: { isVisible?: boolean }) =>
      isVisible ? <div data-testid="node-resizer" /> : null,
    useReactFlow: () => ({
      setNodes: (updater: unknown) => setNodesMock(updater),
    }),
  };
});

import { StickyNoteNode } from "../StickyNoteNode";

function makeProps(
  data: Record<string, unknown> = {},
  selected = false,
): NodeProps {
  return {
    id: "sticky-1",
    data: {
      graphNodeType: "sticky_note",
      label: "",
      raw: {},
      text: "hello",
      color: "yellow",
      ...data,
    },
    selected,
    dragging: false,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    zIndex: 1,
    type: "sticky_note",
    width: 200,
    height: 150,
    sourcePosition: undefined,
    targetPosition: undefined,
  } as unknown as NodeProps;
}

describe("StickyNoteNode", () => {
  it("renders the text from node.data", () => {
    render(<StickyNoteNode {...makeProps({ text: "hello world" })} />);
    const textarea = screen.getByTestId("sticky-note-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("hello world");
  });

  it("applies the color via background-color token", () => {
    render(<StickyNoteNode {...makeProps({ color: "pink" })} />);
    const node = screen.getByTestId("sticky-note-node");
    expect(node.getAttribute("data-sticky-color")).toBe("pink");
    expect(node.style.backgroundColor).toContain("--gc-sticky-bg-pink");
  });

  it("updates data on textarea change", () => {
    setNodesMock.mockClear();
    render(<StickyNoteNode {...makeProps({ text: "" })} />);
    const textarea = screen.getByTestId("sticky-note-textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "new text" } });
    expect(setNodesMock).toHaveBeenCalledTimes(1);
    const updater = setNodesMock.mock.calls[0][0] as (nodes: unknown[]) => unknown[];
    const result = updater([
      { id: "sticky-1", data: { graphNodeType: "sticky_note", label: "", raw: {}, text: "" } },
      { id: "other", data: { graphNodeType: "task", label: "", raw: {} } },
    ]) as Array<{ id: string; data: { text?: string } }>;
    expect(result[0].data.text).toBe("new text");
    expect(result[1].data.text).toBeUndefined();
  });

  it("shows resize handles only when selected", () => {
    const { rerender } = render(<StickyNoteNode {...makeProps({}, false)} />);
    expect(screen.queryByTestId("node-resizer")).toBeNull();
    rerender(<StickyNoteNode {...makeProps({}, true)} />);
    expect(screen.getByTestId("node-resizer")).not.toBeNull();
  });
});
