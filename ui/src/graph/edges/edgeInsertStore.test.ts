// Copyright GraphCaster. All Rights Reserved.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEdgeInsertStore } from "./edgeInsertStore";

describe("edgeInsertStore", () => {
  beforeEach(() => {
    useEdgeInsertStore.setState({
      open: false,
      edgeId: null,
      anchor: null,
      confirmHandler: null,
    });
  });

  it("requestInsert opens the popover with edge id and anchor", () => {
    useEdgeInsertStore.getState().requestInsert("e-42", 100, 200);
    const s = useEdgeInsertStore.getState();
    expect(s.open).toBe(true);
    expect(s.edgeId).toBe("e-42");
    expect(s.anchor).toEqual({ x: 100, y: 200 });
  });

  it("cancel closes the popover and clears state", () => {
    useEdgeInsertStore.getState().requestInsert("e-42", 1, 2);
    useEdgeInsertStore.getState().cancel();
    const s = useEdgeInsertStore.getState();
    expect(s.open).toBe(false);
    expect(s.edgeId).toBeNull();
    expect(s.anchor).toBeNull();
  });

  it("confirm invokes the registered handler with edge id, type, anchor", () => {
    const handler = vi.fn();
    useEdgeInsertStore.getState().registerConfirmHandler(handler);
    useEdgeInsertStore.getState().requestInsert("e-7", 10, 20);
    useEdgeInsertStore.getState().confirm("task");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("e-7", "task", { x: 10, y: 20 });
    const s = useEdgeInsertStore.getState();
    expect(s.open).toBe(false);
    expect(s.edgeId).toBeNull();
  });

  it("confirm is a no-op when no handler is registered", () => {
    useEdgeInsertStore.getState().requestInsert("e-7", 10, 20);
    expect(() => {
      useEdgeInsertStore.getState().confirm("task");
    }).not.toThrow();
    expect(useEdgeInsertStore.getState().open).toBe(false);
  });
});
