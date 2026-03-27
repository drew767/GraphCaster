// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { findWorkspaceGraphRefCycle } from "./workspaceGraphRefCycles";

const ga = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const gb = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const gc = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("findWorkspaceGraphRefCycle", () => {
  it("returns null when no edges", () => {
    expect(findWorkspaceGraphRefCycle([{ graphId: ga, refTargets: [] }])).toBeNull();
  });

  it("returns null for linear chain", () => {
    expect(
      findWorkspaceGraphRefCycle([
        { graphId: ga, refTargets: [gb] },
        { graphId: gb, refTargets: [gc] },
        { graphId: gc, refTargets: [] },
      ]),
    ).toBeNull();
  });

  it("detects 3-cycle with same ids as Python", () => {
    const cyc = findWorkspaceGraphRefCycle([
      { graphId: ga, refTargets: [gb] },
      { graphId: gb, refTargets: [gc] },
      { graphId: gc, refTargets: [ga] },
    ]);
    expect(cyc).not.toBeNull();
    expect(new Set(cyc)).toEqual(new Set([ga, gb, gc]));
    expect(cyc).toHaveLength(3);
  });

  it("detects self-loop", () => {
    expect(findWorkspaceGraphRefCycle([{ graphId: ga, refTargets: [ga] }])).toEqual([ga]);
  });

  it("dedupes parallel edges in entries (single entry two targets same)", () => {
    expect(
      findWorkspaceGraphRefCycle([
        { graphId: ga, refTargets: [gb, gb] },
        { graphId: gb, refTargets: [] },
      ]),
    ).toBeNull();
  });

  it("uses first entry per graphId when duplicate graphIds are present", () => {
    expect(
      findWorkspaceGraphRefCycle([
        { graphId: ga, refTargets: [gb] },
        { graphId: ga, refTargets: [gc] },
        { graphId: gb, refTargets: [] },
        { graphId: gc, refTargets: [ga] },
      ]),
    ).toBeNull();
    expect(
      findWorkspaceGraphRefCycle([
        { graphId: ga, refTargets: [gc] },
        { graphId: ga, refTargets: [gb] },
        { graphId: gb, refTargets: [gc] },
        { graphId: gc, refTargets: [ga] },
      ]),
    ).not.toBeNull();
  });
});
