// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LODNodeRenderer, LODLevel } from "../../components/canvas/LODNodeRenderer";
import { useLODLevel } from "../../components/canvas/hooks/useLODLevel";

const sampleData = {
  graphNodeType: "task",
  label: "Test Node",
  raw: {},
};

describe("useLODLevel", () => {
  it("returns HIGH at zoom >= 0.75", () => {
    const { result } = renderHook(() => useLODLevel(1.0));
    expect(result.current).toBe(LODLevel.HIGH);
  });

  it("returns MEDIUM at zoom 0.4-0.75", () => {
    const { result } = renderHook(() => useLODLevel(0.5));
    expect(result.current).toBe(LODLevel.MEDIUM);
  });

  it("returns LOW at zoom 0.2-0.4", () => {
    const { result } = renderHook(() => useLODLevel(0.3));
    expect(result.current).toBe(LODLevel.LOW);
  });

  it("returns GHOST at zoom < 0.2", () => {
    const { result } = renderHook(() => useLODLevel(0.1));
    expect(result.current).toBe(LODLevel.GHOST);
  });
});

describe("LODNodeRenderer", () => {
  const defaultProps = {
    id: "node-1",
    data: sampleData,
    selected: false,
  };

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <ReactFlowProvider>{children}</ReactFlowProvider>
  );

  it("renders full node at HIGH LOD", () => {
    render(<LODNodeRenderer {...defaultProps} lodLevel={LODLevel.HIGH} />, { wrapper: Wrapper });

    expect(screen.getByText("Test Node")).toBeInTheDocument();
  });

  it("renders simplified node at MEDIUM LOD", () => {
    render(<LODNodeRenderer {...defaultProps} lodLevel={LODLevel.MEDIUM} />, { wrapper: Wrapper });

    expect(screen.getByText("Test Node")).toBeInTheDocument();
    expect(screen.queryByTestId("node-details")).not.toBeInTheDocument();
  });

  it("renders minimal indicator at LOW LOD", () => {
    render(<LODNodeRenderer {...defaultProps} lodLevel={LODLevel.LOW} />, { wrapper: Wrapper });

    expect(screen.queryByText("Test Node")).not.toBeInTheDocument();
    expect(screen.getByTestId("node-shape")).toBeInTheDocument();
  });

  it("renders ghost placeholder at GHOST LOD", () => {
    render(<LODNodeRenderer {...defaultProps} lodLevel={LODLevel.GHOST} />, { wrapper: Wrapper });

    expect(screen.getByTestId("node-ghost")).toBeInTheDocument();
  });

  it("applies gc-lod-node base class plus LOD modifier", () => {
    const { rerender, container } = render(
      <LODNodeRenderer {...defaultProps} lodLevel={LODLevel.LOW} />,
      { wrapper: Wrapper },
    );
    const lowNode = container.querySelector(".gc-lod-node");
    expect(lowNode).not.toBeNull();
    expect(lowNode?.classList.contains("gc-lod-node--low")).toBe(true);

    rerender(<LODNodeRenderer {...defaultProps} lodLevel={LODLevel.HIGH} />);
    const highNode = container.querySelector(".gc-lod-node");
    expect(highNode?.classList.contains("gc-lod-node--high")).toBe(true);
  });

  it("toggles gc-lod-node--selected based on the selected prop", () => {
    const { rerender, container } = render(
      <LODNodeRenderer {...defaultProps} lodLevel={LODLevel.HIGH} />,
      { wrapper: Wrapper },
    );
    expect(container.querySelector(".gc-lod-node--selected")).toBeNull();

    rerender(
      <LODNodeRenderer {...defaultProps} selected lodLevel={LODLevel.HIGH} />,
    );
    expect(container.querySelector(".gc-lod-node--selected")).not.toBeNull();
  });

  it("keeps only the dynamic backgroundColor inline (no static layout properties)", () => {
    const { container } = render(
      <LODNodeRenderer {...defaultProps} lodLevel={LODLevel.HIGH} />,
      { wrapper: Wrapper },
    );
    const node = container.querySelector<HTMLElement>(".gc-lod-node");
    expect(node).not.toBeNull();
    // Static layout should be CSS-driven, not part of the inline `style` attribute.
    const inline = node?.getAttribute("style") ?? "";
    expect(inline.toLowerCase()).toContain("background-color");
    expect(inline.toLowerCase()).not.toContain("padding");
    expect(inline.toLowerCase()).not.toContain("border-radius");
  });
});
