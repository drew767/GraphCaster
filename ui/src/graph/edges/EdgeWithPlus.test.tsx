// Copyright GraphCaster. All Rights Reserved.

import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../i18n";

// Mock @xyflow/react: BaseEdge → <path/>, EdgeLabelRenderer → children,
// useInternalNode → null (no AI route detection), useReactFlow → setEdges spy.
const setEdgesSpy = vi.fn();
vi.mock("@xyflow/react", () => {
  return {
    BaseEdge: (props: { id?: string; path?: string }) => (
      <path data-testid={`base-edge-${props.id}`} d={props.path} />
    ),
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    getBezierPath: (args: {
      sourceX: number;
      sourceY: number;
      targetX: number;
      targetY: number;
    }) => {
      const lx = (args.sourceX + args.targetX) / 2;
      const ly = (args.sourceY + args.targetY) / 2;
      return [`M${args.sourceX},${args.sourceY} L${args.targetX},${args.targetY}`, lx, ly];
    },
    getSmoothStepPath: (args: {
      sourceX: number;
      sourceY: number;
      targetX: number;
      targetY: number;
    }) => {
      const lx = (args.sourceX + args.targetX) / 2;
      const ly = (args.sourceY + args.targetY) / 2;
      return [`M${args.sourceX},${args.sourceY} L${args.targetX},${args.targetY}`, lx, ly];
    },
    useInternalNode: () => null,
    useReactFlow: () => ({ setEdges: setEdgesSpy }),
  };
});

import * as React from "react";

import { EdgeWithPlus } from "./EdgeWithPlus";
import { useEdgeInsertStore } from "./edgeInsertStore";

function renderEdge(id = "e1") {
  return render(
    <svg>
      <EdgeWithPlus
        // Required EdgeProps fields used by the component:
        id={id}
        source="a"
        target="b"
        sourceX={0}
        sourceY={0}
        targetX={200}
        targetY={0}
        sourcePosition={"right" as never}
        targetPosition={"left" as never}
      />
    </svg>,
  );
}

describe("EdgeWithPlus", () => {
  beforeEach(() => {
    setEdgesSpy.mockReset();
    useEdgeInsertStore.setState({
      open: false,
      edgeId: null,
      anchor: null,
      confirmHandler: null,
    });
  });

  it("reveals plus and delete buttons on hover and toggles data-hovered", () => {
    renderEdge();
    const hot = document.querySelector('[data-testid="gc-edge-with-plus-e1"]') as HTMLElement;
    expect(hot).not.toBeNull();
    expect(hot.getAttribute("data-hovered")).toBe("false");
    expect(document.querySelector('[data-testid="gc-edge-plus-e1"]')).toBeNull();
    expect(document.querySelector('[data-testid="gc-edge-delete-e1"]')).toBeNull();

    act(() => {
      fireEvent.mouseEnter(hot);
    });

    expect(hot.getAttribute("data-hovered")).toBe("true");
    expect(document.querySelector('[data-testid="gc-edge-plus-e1"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="gc-edge-delete-e1"]')).not.toBeNull();

    act(() => {
      fireEvent.mouseLeave(hot);
    });
    expect(hot.getAttribute("data-hovered")).toBe("false");
  });

  it("opens the edge insert store with edge id and anchor when plus is clicked", () => {
    renderEdge();
    const hot = document.querySelector('[data-testid="gc-edge-with-plus-e1"]') as HTMLElement;
    act(() => {
      fireEvent.mouseEnter(hot);
    });
    const plus = document.querySelector(
      '[data-testid="gc-edge-plus-e1"]',
    ) as HTMLButtonElement | null;
    expect(plus).not.toBeNull();
    act(() => {
      fireEvent.click(plus!, { clientX: 123, clientY: 456 });
    });
    const state = useEdgeInsertStore.getState();
    expect(state.open).toBe(true);
    expect(state.edgeId).toBe("e1");
    expect(state.anchor).toEqual({ x: 123, y: 456 });
  });

  it("removes the edge from setEdges when delete is clicked", () => {
    renderEdge("e-del");
    const hot = document.querySelector('[data-testid="gc-edge-with-plus-e-del"]') as HTMLElement;
    act(() => {
      fireEvent.mouseEnter(hot);
    });
    const del = document.querySelector(
      '[data-testid="gc-edge-delete-e-del"]',
    ) as HTMLButtonElement | null;
    expect(del).not.toBeNull();
    act(() => {
      fireEvent.click(del!);
    });
    expect(setEdgesSpy).toHaveBeenCalledTimes(1);
    const reducer = setEdgesSpy.mock.calls[0][0] as (edges: { id: string }[]) => unknown;
    const before = [{ id: "e-del" }, { id: "other" }];
    expect(reducer(before)).toEqual([{ id: "other" }]);
  });
});
