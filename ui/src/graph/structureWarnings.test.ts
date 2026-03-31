// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import type { WorkspaceGraphEntry } from "../lib/workspaceFs";
import {
  edgeIdsForStructureIssueHighlights,
  findStructureIssues,
  structureIssuesBlockRun,
  workspaceGraphRefCycleIssues,
  type StructureIssue,
} from "./structureWarnings";
import type { GraphDocumentJson } from "./types";

function doc(
  partial: Omit<GraphDocumentJson, "schemaVersion" | "meta" | "viewport"> &
    Partial<Pick<GraphDocumentJson, "viewport" | "schemaVersion" | "meta">>,
): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId: "ffffffff-ffff-4fff-8fff-ffffffffffff", title: "t" },
    viewport: partial.viewport ?? { x: 0, y: 0, zoom: 1 },
    ...partial,
  };
}

describe("structureIssuesBlockRun", () => {
  it("is false when only unreachable_nodes", () => {
    const issues: StructureIssue[] = [{ kind: "unreachable_nodes", ids: ["x"] }];
    expect(structureIssuesBlockRun(issues)).toBe(false);
  });

  it("is true for no_start", () => {
    expect(structureIssuesBlockRun([{ kind: "no_start" }])).toBe(true);
  });

  it("is true when unreachable is combined with a blocking issue", () => {
    const issues: StructureIssue[] = [
      { kind: "unreachable_nodes", ids: ["x"] },
      { kind: "no_start" },
    ];
    expect(structureIssuesBlockRun(issues)).toBe(true);
  });

  it("is true for start_has_incoming and multiple_starts", () => {
    expect(structureIssuesBlockRun([{ kind: "start_has_incoming", startId: "s" }])).toBe(true);
    expect(
      structureIssuesBlockRun([{ kind: "multiple_starts", ids: ["a", "b"] }]),
    ).toBe(true);
  });

  it("is true for trigger_has_incoming", () => {
    expect(
      structureIssuesBlockRun([
        { kind: "trigger_has_incoming", nodeId: "w1", triggerType: "trigger_webhook" },
      ]),
    ).toBe(true);
  });

  it("is false when only merge_few_inputs", () => {
    expect(
      structureIssuesBlockRun([{ kind: "merge_few_inputs", nodeId: "m1", incomingEdges: 1 }]),
    ).toBe(false);
  });

  it("is false when only fork_few_outputs or barrier_merge_out_error", () => {
    expect(
      structureIssuesBlockRun([{ kind: "fork_few_outputs", nodeId: "f1", unconditionalOutgoing: 1 }]),
    ).toBe(false);
    expect(
      structureIssuesBlockRun([
        { kind: "barrier_merge_out_error_incoming", edgeId: "e1", mergeNodeId: "m1" },
      ]),
    ).toBe(false);
  });

  it("is true for graph_ref_workspace_cycle", () => {
    expect(
      structureIssuesBlockRun([
        { kind: "graph_ref_workspace_cycle", cycle: ["a", "b"] },
      ]),
    ).toBe(true);
  });

  it("is false when only ai_route warnings", () => {
    expect(
      structureIssuesBlockRun([
        { kind: "ai_route_no_outgoing", nodeId: "a", outgoingEdges: 0 },
        {
          kind: "ai_route_missing_route_descriptions",
          nodeId: "b",
          outgoingEdges: 2,
          missingDescriptions: 1,
        },
      ]),
    ).toBe(false);
  });

  it("is false for schema_version_mismatch", () => {
    expect(
      structureIssuesBlockRun([{ kind: "schema_version_mismatch", root: 1, meta: 2 }]),
    ).toBe(false);
  });

  it("is false when only delay/debounce/wait_for warnings", () => {
    expect(
      structureIssuesBlockRun([
        { kind: "delay_invalid_duration", nodeId: "d1" },
        { kind: "wait_for_empty_path", nodeId: "w1" },
      ]),
    ).toBe(false);
  });
});

describe("workspaceGraphRefCycleIssues", () => {
  it("returns blocking issue when workspace entries form a cycle", () => {
    const ga = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const gb = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const entries: WorkspaceGraphEntry[] = [
      { fileName: "a.json", graphId: ga, duplicateGraphId: false, refTargets: [gb] },
      { fileName: "b.json", graphId: gb, duplicateGraphId: false, refTargets: [ga] },
    ];
    const issues = workspaceGraphRefCycleIssues(entries);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("graph_ref_workspace_cycle");
    expect(structureIssuesBlockRun(issues)).toBe(true);
  });

  it("returns empty when no cycle", () => {
    const ga = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const gb = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const entries: WorkspaceGraphEntry[] = [
      { fileName: "a.json", graphId: ga, duplicateGraphId: false, refTargets: [gb] },
      { fileName: "b.json", graphId: gb, duplicateGraphId: false, refTargets: [] },
    ];
    expect(workspaceGraphRefCycleIssues(entries)).toHaveLength(0);
  });
});

describe("findStructureIssues", () => {
  it("adds schema_version_mismatch when root and meta.schemaVersion differ", () => {
    const g = doc({
      schemaVersion: 1,
      meta: {
        schemaVersion: 2,
        graphId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        title: "t",
      },
      nodes: [{ id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    const issues = findStructureIssues(g);
    expect(issues.some((i) => i.kind === "schema_version_mismatch" && i.root === 1 && i.meta === 2)).toBe(
      true,
    );
  });

  it("does not add schema_version_mismatch when values match", () => {
    const g = doc({
      schemaVersion: 2,
      meta: {
        schemaVersion: 2,
        graphId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        title: "t",
      },
      nodes: [{ id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    expect(findStructureIssues(g).some((i) => i.kind === "schema_version_mismatch")).toBe(false);
  });

  it("adds unreachable_nodes for orphan non-comment node", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: {} },
        { id: "orphan", type: "task", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e1",
          source: "s1",
          sourceHandle: "out_default",
          target: "t1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(issues.some((i) => i.kind === "unreachable_nodes" && i.ids.includes("orphan"))).toBe(true);
  });

  it("skips reachability when start has incoming edge", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: {} },
        { id: "orphan", type: "task", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "bad",
          source: "t1",
          sourceHandle: "out_default",
          target: "s1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(issues.some((i) => i.kind === "unreachable_nodes")).toBe(false);
  });

  it("adds merge_few_inputs when merge has one incoming from non-comment", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "m1", type: "merge", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e1",
          source: "s1",
          sourceHandle: "out_default",
          target: "m1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(
      issues.some(
        (i) => i.kind === "merge_few_inputs" && i.nodeId === "m1" && i.incomingEdges === 1,
      ),
    ).toBe(true);
  });

  it("adds fork_few_outputs when fork has one unconditional branch", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "f1", type: "fork", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e0",
          source: "s1",
          sourceHandle: "out_default",
          target: "f1",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "e1",
          source: "f1",
          sourceHandle: "out_default",
          target: "t1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(
      issues.some(
        (i) =>
          i.kind === "fork_few_outputs" && i.nodeId === "f1" && i.unconditionalOutgoing === 1,
      ),
    ).toBe(true);
  });

  it("adds barrier_merge_out_error_incoming", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "x" } },
        { id: "m1", type: "merge", position: { x: 0, y: 0 }, data: { mode: "barrier" } },
      ],
      edges: [
        {
          id: "e0",
          source: "s1",
          sourceHandle: "out_default",
          target: "t1",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "ee",
          source: "t1",
          sourceHandle: "out_error",
          target: "m1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(
      issues.some(
        (i) =>
          i.kind === "barrier_merge_out_error_incoming" &&
          i.edgeId === "ee" &&
          i.mergeNodeId === "m1",
      ),
    ).toBe(true);
  });

  it("adds barrier_merge_no_success_incoming when only out_error feeds barrier", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "x" } },
        { id: "t2", type: "task", position: { x: 0, y: 0 }, data: { command: "y" } },
        { id: "m1", type: "merge", position: { x: 0, y: 0 }, data: { mode: "barrier" } },
      ],
      edges: [
        {
          id: "e0",
          source: "s1",
          sourceHandle: "out_default",
          target: "t1",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "e1",
          source: "s1",
          sourceHandle: "out_default",
          target: "t2",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "e2",
          source: "t1",
          sourceHandle: "out_error",
          target: "m1",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "e3",
          source: "t2",
          sourceHandle: "out_error",
          target: "m1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(issues.some((i) => i.kind === "barrier_merge_no_success_incoming" && i.nodeId === "m1")).toBe(true);
  });

  it("flags ai_route without outgoing branches to executable nodes", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "ar", type: "ai_route", position: { x: 0, y: 0 }, data: {} },
        { id: "e1", type: "exit", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e0",
          source: "s1",
          sourceHandle: "out_default",
          target: "ar",
          targetHandle: "in_default",
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(issues.some((i) => i.kind === "ai_route_no_outgoing" && i.nodeId === "ar")).toBe(true);
  });

  it("flags ai_route with multiple branches missing routeDescription", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "ar", type: "ai_route", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "a" } },
        { id: "t2", type: "task", position: { x: 0, y: 0 }, data: { command: "b" } },
        { id: "e1", type: "exit", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e0",
          source: "s1",
          sourceHandle: "out_default",
          target: "ar",
          targetHandle: "in_default",
        },
        {
          id: "e1",
          source: "ar",
          sourceHandle: "out_default",
          target: "t1",
          targetHandle: "in_default",
        },
        {
          id: "e2",
          source: "ar",
          sourceHandle: "out_default",
          target: "t2",
          targetHandle: "in_default",
        },
        {
          id: "e3",
          source: "t1",
          sourceHandle: "out_default",
          target: "e1",
          targetHandle: "in_default",
        },
        {
          id: "e4",
          source: "t2",
          sourceHandle: "out_default",
          target: "e1",
          targetHandle: "in_default",
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(
      issues.some(
        (i) =>
          i.kind === "ai_route_missing_route_descriptions" &&
          i.nodeId === "ar" &&
          i.missingDescriptions >= 1,
      ),
    ).toBe(true);
  });

  it("adds agent_missing_prompt when agent node has no user message field", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "a1", type: "agent", position: { x: 0, y: 0 }, data: { title: "A" } },
        { id: "a2", type: "agent", position: { x: 0, y: 0 }, data: { inputText: "hello" } },
      ],
      edges: [],
    });
    const issues = findStructureIssues(g);
    expect(issues.some((i) => i.kind === "agent_missing_prompt" && i.nodeId === "a1")).toBe(true);
    expect(issues.some((i) => i.kind === "agent_missing_prompt" && i.nodeId === "a2")).toBe(false);
  });
});

describe("edgeIdsForStructureIssueHighlights", () => {
  it("marks incoming edges to start", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "bad",
          source: "t1",
          sourceHandle: "out_default",
          target: "s1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect([...edgeIdsForStructureIssueHighlights(g, issues)]).toEqual(["bad"]);
  });

  it("marks out_error edge into barrier merge", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "x" } },
        {
          id: "m1",
          type: "merge",
          position: { x: 0, y: 0 },
          data: { mode: "barrier" },
        },
      ],
      edges: [
        {
          id: "ok",
          source: "s1",
          sourceHandle: "out_default",
          target: "m1",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "errIn",
          source: "t1",
          sourceHandle: "out_error",
          target: "m1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(issues.some((i) => i.kind === "barrier_merge_out_error_incoming")).toBe(true);
    expect([...edgeIdsForStructureIssueHighlights(g, issues)]).toContain("errIn");
  });

  it("marks ai_route usable edges without route description", () => {
    const g = doc({
      nodes: [
        { id: "ar", type: "ai_route", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "a" } },
        { id: "t2", type: "task", position: { x: 0, y: 0 }, data: { command: "b" } },
      ],
      edges: [
        {
          id: "e1",
          source: "ar",
          sourceHandle: "out_default",
          target: "t1",
          targetHandle: "in_default",
        },
        {
          id: "e2",
          source: "ar",
          sourceHandle: "out_default",
          target: "t2",
          targetHandle: "in_default",
          data: { routeDescription: "ok" },
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(issues.some((i) => i.kind === "ai_route_missing_route_descriptions")).toBe(true);
    const ids = edgeIdsForStructureIssueHighlights(g, issues);
    expect(ids.has("e1")).toBe(true);
    expect(ids.has("e2")).toBe(false);
  });

  it("adds http_request_empty_url when url missing or blank", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "h1", type: "http_request", position: { x: 0, y: 0 }, data: { title: "x" } },
        { id: "h2", type: "http_request", position: { x: 0, y: 0 }, data: { url: "   " } },
      ],
      edges: [],
    });
    const issues = findStructureIssues(g);
    expect(issues.filter((i) => i.kind === "http_request_empty_url").map((i) => i.nodeId).sort()).toEqual([
      "h1",
      "h2",
    ]);
  });

  it("adds rag_query_empty_url and rag_query_empty_query when missing or blank", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "r1", type: "rag_query", position: { x: 0, y: 0 }, data: { title: "x" } },
        { id: "r2", type: "rag_query", position: { x: 0, y: 0 }, data: { url: "   " } },
        {
          id: "r3",
          type: "rag_query",
          position: { x: 0, y: 0 },
          data: { url: "https://x.test", query: "  " },
        },
        {
          id: "r4",
          type: "rag_query",
          position: { x: 0, y: 0 },
          data: { url: "https://x.test", query: "ok" },
        },
      ],
      edges: [],
    });
    const issues = findStructureIssues(g);
    expect(issues.filter((i) => i.kind === "rag_query_empty_url").map((i) => i.nodeId).sort()).toEqual([
      "r1",
      "r2",
    ]);
    expect(issues.filter((i) => i.kind === "rag_query_empty_query").map((i) => i.nodeId).sort()).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
    expect(issues.some((i) => i.kind === "rag_query_empty_query" && i.nodeId === "r4")).toBe(false);
  });

  it("rag_query memory backend requires collectionId not url", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        {
          id: "m1",
          type: "rag_query",
          position: { x: 0, y: 0 },
          data: { vectorBackend: "memory", query: "q" },
        },
        {
          id: "m2",
          type: "rag_query",
          position: { x: 0, y: 0 },
          data: { vectorBackend: "memory", collectionId: "c", query: "q" },
        },
      ],
      edges: [],
    });
    const issues = findStructureIssues(g);
    expect(issues.filter((i) => i.kind === "rag_memory_empty_collection").map((i) => i.nodeId)).toEqual([
      "m1",
    ]);
    expect(issues.filter((i) => i.kind === "rag_query_empty_url" && i.nodeId === "m1")).toHaveLength(0);
    expect(issues.some((i) => i.nodeId === "m2")).toBe(false);
  });

  it("rag_index issues when collectionId or text empty", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "i1", type: "rag_index", position: { x: 0, y: 0 }, data: {} },
        { id: "i2", type: "rag_index", position: { x: 0, y: 0 }, data: { collectionId: "c", text: "" } },
        {
          id: "ok",
          type: "rag_index",
          position: { x: 0, y: 0 },
          data: { collectionId: "c", text: "hello" },
        },
      ],
      edges: [],
    });
    const issues = findStructureIssues(g);
    expect(
      issues.filter((i) => i.kind === "rag_index_empty_collection_id").map((i) => i.nodeId).sort(),
    ).toEqual(["i1"]);
    expect(issues.filter((i) => i.kind === "rag_index_empty_text").map((i) => i.nodeId).sort()).toEqual([
      "i1",
      "i2",
    ]);
    expect(issues.some((i) => i.nodeId === "ok")).toBe(false);
  });

  it("adds timer node structure issues for delay, debounce, and wait_for", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "d1", type: "delay", position: { x: 0, y: 0 }, data: {} },
        { id: "d2", type: "delay", position: { x: 0, y: 0 }, data: { durationSec: 0 } },
        { id: "b1", type: "debounce", position: { x: 0, y: 0 }, data: { durationSec: -1 } },
        { id: "w1", type: "wait_for", position: { x: 0, y: 0 }, data: { waitMode: "signal" } },
        { id: "w2", type: "wait_for", position: { x: 0, y: 0 }, data: { waitMode: "file", path: "" } },
        { id: "w3", type: "wait_for", position: { x: 0, y: 0 }, data: { path: "p", timeoutSec: 0 } },
        { id: "okD", type: "delay", position: { x: 0, y: 0 }, data: { durationSec: 1 } },
        { id: "okW", type: "wait_for", position: { x: 0, y: 0 }, data: { path: "f.txt", timeoutSec: 10 } },
      ],
      edges: [],
    });
    const issues = findStructureIssues(g);
    expect(issues.filter((i) => i.kind === "delay_invalid_duration").map((i) => i.nodeId).sort()).toEqual([
      "d1",
      "d2",
    ]);
    expect(
      issues.filter((i) => i.kind === "debounce_invalid_duration").map((i) => i.nodeId).sort(),
    ).toEqual(["b1"]);
    expect(
      issues.filter((i) => i.kind === "wait_for_unknown_mode").map((i) => i.nodeId).sort(),
    ).toEqual(["w1"]);
    expect(issues.filter((i) => i.kind === "wait_for_empty_path").map((i) => i.nodeId).sort()).toEqual([
      "w2",
    ]);
    expect(
      issues.filter((i) => i.kind === "wait_for_invalid_timeout").map((i) => i.nodeId).sort(),
    ).toEqual(["w3"]);
    expect(issues.filter((i) => i.nodeId === "okD")).toHaveLength(0);
    expect(issues.filter((i) => i.nodeId === "okW")).toHaveLength(0);
  });

  it("adds python_code_empty_code when code missing or blank", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "p1", type: "python_code", position: { x: 0, y: 0 }, data: { title: "x" } },
        { id: "p2", type: "python_code", position: { x: 0, y: 0 }, data: { code: "   " } },
      ],
      edges: [],
    });
    const issues = findStructureIssues(g);
    expect(issues.filter((i) => i.kind === "python_code_empty_code").map((i) => i.nodeId).sort()).toEqual([
      "p1",
      "p2",
    ]);
  });
});
