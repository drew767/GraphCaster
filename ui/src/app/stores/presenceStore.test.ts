// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach } from "vitest";

import { usePresenceStore } from "./presenceStore";

beforeEach(() => {
  usePresenceStore.setState({ byWorkflow: {} });
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});

describe("presenceStore", () => {
  it("setPresence / getPresence round-trip", () => {
    usePresenceStore.getState().setPresence("wf-1", [
      { name: "Alice", color: "#abc" },
      { name: "Bob" },
    ]);
    const got = usePresenceStore.getState().getPresence("wf-1");
    expect(got).toHaveLength(2);
    expect(got[0].name).toBe("Alice");
  });

  it("loadFromLocalStorage parses {name,color}", () => {
    localStorage.setItem(
      "gc.presence.wf-2",
      JSON.stringify([{ name: "Carol", color: "#f00" }, { name: "Dave" }]),
    );
    const got = usePresenceStore.getState().loadFromLocalStorage("wf-2");
    expect(got).toEqual([
      { name: "Carol", color: "#f00" },
      { name: "Dave", color: undefined },
    ]);
  });

  it("loadFromLocalStorage returns [] on malformed JSON", () => {
    localStorage.setItem("gc.presence.wf-3", "{not-json}");
    expect(usePresenceStore.getState().loadFromLocalStorage("wf-3")).toEqual([]);
  });

  it("loadFromLocalStorage filters non-string names", () => {
    localStorage.setItem(
      "gc.presence.wf-4",
      JSON.stringify([{ name: "Eve" }, { name: 99 }, null]),
    );
    const got = usePresenceStore.getState().loadFromLocalStorage("wf-4");
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("Eve");
  });
});
