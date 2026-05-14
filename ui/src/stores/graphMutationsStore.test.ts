// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  isNodeMode,
  useGraphMutationsStore,
  type GraphMutationCommand,
} from "./graphMutationsStore";

describe("graphMutationsStore", () => {
  beforeEach(() => {
    useGraphMutationsStore.getState().registerHandler(null);
  });

  it("isNodeMode accepts the four allowed values", () => {
    expect(isNodeMode("normal")).toBe(true);
    expect(isNodeMode("bypass")).toBe(true);
    expect(isNodeMode("mute")).toBe(true);
    expect(isNodeMode("disabled")).toBe(true);
    expect(isNodeMode("rejected")).toBe(false);
    expect(isNodeMode(null)).toBe(false);
  });

  it("dispatch is a no-op (with warning) when no handler is registered", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useGraphMutationsStore.getState().setNodeMode(["a"], "bypass");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("setNodeMode dispatches a setNodeMode command to the registered handler", () => {
    const seen: GraphMutationCommand[] = [];
    useGraphMutationsStore.getState().registerHandler((cmd) => {
      seen.push(cmd);
    });
    useGraphMutationsStore.getState().setNodeMode(["n1", "n2"], "mute");
    expect(seen).toEqual([{ kind: "setNodeMode", nodeIds: ["n1", "n2"], mode: "mute" }]);
  });

  it("toggleCollapse and togglePin dispatch the right command kind", () => {
    const seen: GraphMutationCommand[] = [];
    useGraphMutationsStore.getState().registerHandler((cmd) => {
      seen.push(cmd);
    });
    useGraphMutationsStore.getState().toggleCollapse(["a"]);
    useGraphMutationsStore.getState().togglePin(["b"]);
    expect(seen).toEqual([
      { kind: "toggleCollapse", nodeIds: ["a"] },
      { kind: "togglePin", nodeIds: ["b"] },
    ]);
  });

  it("empty nodeIds short-circuit before dispatch", () => {
    const seen: GraphMutationCommand[] = [];
    useGraphMutationsStore.getState().registerHandler((cmd) => {
      seen.push(cmd);
    });
    useGraphMutationsStore.getState().setNodeMode([], "bypass");
    useGraphMutationsStore.getState().toggleCollapse([]);
    useGraphMutationsStore.getState().togglePin([]);
    expect(seen).toEqual([]);
  });
});
