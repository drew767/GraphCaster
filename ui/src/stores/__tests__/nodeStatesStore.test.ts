// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  applyNodeStateToggle,
  countNodeStates,
  readNodeState,
  toggleNodeStateBypassed,
  toggleNodeStateMuted,
  toggleNodeStatePinned,
} from "../../graph/nodeStates";

describe("nodeStates: togglePin (pinned)", () => {
  it("sets pinned=true when previously unset", () => {
    const result = toggleNodeStatePinned({});
    expect(result.pinned).toBe(true);
  });

  it("clears pinned when previously true", () => {
    const result = toggleNodeStatePinned({ pinned: true });
    expect("pinned" in result).toBe(false);
  });

  it("does not affect siblings", () => {
    const result = toggleNodeStatePinned({ title: "X", muted: true });
    expect(result.title).toBe("X");
    expect(result.muted).toBe(true);
    expect(result.pinned).toBe(true);
  });

  it("returns a new object (immutability)", () => {
    const input = { pinned: true };
    const result = toggleNodeStatePinned(input);
    expect(result).not.toBe(input);
    expect((input as { pinned?: boolean }).pinned).toBe(true);
  });
});

describe("nodeStates: setNodeMode (mute / bypass toggles)", () => {
  it("toggleNodeStateMuted sets when unset and clears when set", () => {
    expect(toggleNodeStateMuted({}).muted).toBe(true);
    expect("muted" in toggleNodeStateMuted({ muted: true })).toBe(false);
  });

  it("toggleNodeStateBypassed sets when unset and clears when set", () => {
    expect(toggleNodeStateBypassed({}).bypassed).toBe(true);
    expect("bypassed" in toggleNodeStateBypassed({ bypassed: true })).toBe(false);
  });

  it("muted and bypassed are independent flags", () => {
    const both = toggleNodeStateBypassed(toggleNodeStateMuted({}));
    expect(both.muted).toBe(true);
    expect(both.bypassed).toBe(true);
    const clearedMute = toggleNodeStateMuted(both);
    expect("muted" in clearedMute).toBe(false);
    expect(clearedMute.bypassed).toBe(true);
  });
});

describe("nodeStates: toggleCollapse-equivalent (applyNodeStateToggle batching)", () => {
  it("only toggles nodes in the selection", () => {
    const nodes = [
      { id: "a", data: {} },
      { id: "b", data: {} },
      { id: "c", data: {} },
    ];
    const result = applyNodeStateToggle(nodes, new Set(["a", "c"]), "pinned");
    expect(result.find((n) => n.id === "a")?.data?.pinned).toBe(true);
    expect(result.find((n) => n.id === "b")?.data?.pinned).toBeUndefined();
    expect(result.find((n) => n.id === "c")?.data?.pinned).toBe(true);
  });

  it("clears the flag when already set across multiple nodes", () => {
    const nodes = [
      { id: "a", data: { muted: true } },
      { id: "b", data: { muted: true } },
    ];
    const result = applyNodeStateToggle(nodes, new Set(["a", "b"]), "muted");
    expect("muted" in (result[0]?.data ?? {})).toBe(false);
    expect("muted" in (result[1]?.data ?? {})).toBe(false);
  });

  it("normalizes nodes whose data is missing", () => {
    const nodes = [{ id: "a" } as { id: string; data?: Record<string, unknown> }];
    const result = applyNodeStateToggle(nodes, new Set(["a"]), "bypassed");
    expect(result[0]?.data?.bypassed).toBe(true);
  });

  it("does not mutate the input array", () => {
    const nodes = [{ id: "a", data: {} }];
    const result = applyNodeStateToggle(nodes, new Set(["a"]), "muted");
    expect(result).not.toBe(nodes);
    expect(nodes[0].data).toEqual({});
  });
});

describe("nodeStates: readNodeState / countNodeStates", () => {
  it("readNodeState returns false trio for empty data", () => {
    const state = readNodeState({});
    expect(state).toEqual({ muted: false, bypassed: false, pinned: false });
  });

  it("readNodeState surfaces all three flags", () => {
    const state = readNodeState({ muted: true, bypassed: true, pinned: true });
    expect(state).toEqual({ muted: true, bypassed: true, pinned: true });
  });

  it("countNodeStates handles mixed inputs", () => {
    const nodes = [
      { data: { muted: true } },
      { data: { bypassed: true } },
      { data: { muted: true, bypassed: true } },
      { data: {} },
      { data: undefined },
      {},
    ];
    const { muted, bypassed } = countNodeStates(
      nodes as { data?: Record<string, unknown> }[],
    );
    expect(muted).toBe(2);
    expect(bypassed).toBe(2);
  });
});
