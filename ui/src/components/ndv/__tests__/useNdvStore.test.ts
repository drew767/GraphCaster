// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useNdvStore } from "../useNdvStore";

beforeEach(() => {
  act(() => {
    useNdvStore.setState({
      activeNodeId: null,
      activeNodeType: null,
      panelWidths: {},
      inputView: {},
      outputView: {},
      itemIndex: {},
    });
  });
  localStorage.clear();
});

describe("useNdvStore", () => {
  it("opens NDV with node id and type", () => {
    const { result } = renderHook(() => useNdvStore());
    act(() => {
      result.current.openNdv("node-1", "task");
    });
    expect(result.current.activeNodeId).toBe("node-1");
    expect(result.current.activeNodeType).toBe("task");
  });

  it("closes NDV and resets active node", () => {
    const { result } = renderHook(() => useNdvStore());
    act(() => {
      result.current.openNdv("node-2", "llm_agent");
      result.current.closeNdv();
    });
    expect(result.current.activeNodeId).toBeNull();
    expect(result.current.activeNodeType).toBeNull();
  });

  it("persists panel widths to localStorage", () => {
    const { result } = renderHook(() => useNdvStore());
    act(() => {
      result.current.setPanelWidths("task", { input: 350, output: 400 });
    });
    const stored = localStorage.getItem("gc-ndv-widths-task");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.input).toBe(350);
    expect(parsed.output).toBe(400);
  });

  it("loads persisted widths on openNdv for a new nodeType", () => {
    localStorage.setItem(
      "gc-ndv-widths-http_request",
      JSON.stringify({ input: 380, output: 420 }),
    );
    const { result } = renderHook(() => useNdvStore());
    act(() => {
      result.current.openNdv("node-3", "http_request");
    });
    expect(result.current.panelWidths["http_request"]?.input).toBe(380);
    expect(result.current.panelWidths["http_request"]?.output).toBe(420);
  });
});
