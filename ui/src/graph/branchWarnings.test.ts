// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { MAX_EDGE_CONDITION_CHARS } from "./edgeConditionTemplates";
import { edgeIdsForBranchAmbiguities, findBranchAmbiguities } from "./branchWarnings";
import type { GraphDocumentJson } from "./types";

describe("findBranchAmbiguities", () => {
  it("flags out_error from start and task without command", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t0", type: "task", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e1",
          source: "s1",
          sourceHandle: "out_error",
          target: "t0",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "e2",
          source: "t0",
          sourceHandle: "out_error",
          target: "s1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    };
    const issues = findBranchAmbiguities(doc).filter((x) => x.kind === "out_error_unreachable");
    expect(issues.map((x) => x.sourceId).sort()).toEqual(["s1", "t0"]);
    expect([...edgeIdsForBranchAmbiguities(doc, issues)].sort()).toEqual(["e1", "e2"]);
  });

  it("does not flag out_error from mcp_tool", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        {
          id: "m1",
          type: "mcp_tool",
          position: { x: 0, y: 0 },
          data: { toolName: "echo", transport: "stdio", command: "x" },
        },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "y" } },
      ],
      edges: [
        {
          id: "e0",
          source: "s1",
          sourceHandle: "out_default",
          target: "m1",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "eerr",
          source: "m1",
          sourceHandle: "out_error",
          target: "t1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    };
    const issues = findBranchAmbiguities(doc).filter((x) => x.kind === "out_error_unreachable");
    expect(issues).toHaveLength(0);
  });

  it("does not flag out_error from graph_ref", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "g1", type: "graph_ref", position: { x: 0, y: 0 }, data: { targetGraphId: "x" } },
      ],
      edges: [
        {
          id: "e0",
          source: "s1",
          sourceHandle: "out_default",
          target: "g1",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "eerr",
          source: "g1",
          sourceHandle: "out_error",
          target: "s1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    };
    const issues = findBranchAmbiguities(doc).filter((x) => x.kind === "out_error_unreachable");
    expect(issues).toHaveLength(0);
  });

  it("flags out_error from http_request without url", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "h1", type: "http_request", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "eerr",
          source: "h1",
          sourceHandle: "out_error",
          target: "s1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    };
    const issues = findBranchAmbiguities(doc).filter((x) => x.kind === "out_error_unreachable");
    expect(issues.map((x) => x.sourceId)).toEqual(["h1"]);
  });

  it("does not flag out_error from http_request with url", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        {
          id: "h1",
          type: "http_request",
          position: { x: 0, y: 0 },
          data: { url: "https://example.com" },
        },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "y" } },
      ],
      edges: [
        {
          id: "e0",
          source: "s1",
          sourceHandle: "out_default",
          target: "h1",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "eerr",
          source: "h1",
          sourceHandle: "out_error",
          target: "t1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    };
    const issues = findBranchAmbiguities(doc).filter((x) => x.kind === "out_error_unreachable");
    expect(issues).toHaveLength(0);
  });

  it("flags out_error from rag_query without url or query", () => {
    const docMissingUrl: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "rq1", type: "rag_query", position: { x: 0, y: 0 }, data: { query: "q" } },
      ],
      edges: [
        {
          id: "eerr",
          source: "rq1",
          sourceHandle: "out_error",
          target: "s1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    };
    expect(
      findBranchAmbiguities(docMissingUrl).filter((x) => x.kind === "out_error_unreachable").map((x) => x.sourceId),
    ).toEqual(["rq1"]);

    const docMissingQuery: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "rq2", type: "rag_query", position: { x: 0, y: 0 }, data: { url: "https://example.com" } },
      ],
      edges: [
        {
          id: "eerr",
          source: "rq2",
          sourceHandle: "out_error",
          target: "s1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    };
    expect(
      findBranchAmbiguities(docMissingQuery).filter((x) => x.kind === "out_error_unreachable").map((x) => x.sourceId),
    ).toEqual(["rq2"]);
  });

  it("does not flag out_error from rag_query with url and query", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        {
          id: "rq1",
          type: "rag_query",
          position: { x: 0, y: 0 },
          data: { url: "https://example.com", query: "hello" },
        },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "y" } },
      ],
      edges: [
        {
          id: "e0",
          source: "s1",
          sourceHandle: "out_default",
          target: "rq1",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "eerr",
          source: "rq1",
          sourceHandle: "out_error",
          target: "t1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    };
    const issues = findBranchAmbiguities(doc).filter((x) => x.kind === "out_error_unreachable");
    expect(issues).toHaveLength(0);
  });

  it("flags out_error from python_code without code", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "py1", type: "python_code", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "eerr",
          source: "py1",
          sourceHandle: "out_error",
          target: "s1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    };
    const issues = findBranchAmbiguities(doc).filter((x) => x.kind === "out_error_unreachable");
    expect(issues.map((x) => x.sourceId)).toEqual(["py1"]);
  });

  it("does not flag out_error from python_code with code", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        {
          id: "py1",
          type: "python_code",
          position: { x: 0, y: 0 },
          data: { code: "result = 1" },
        },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "y" } },
      ],
      edges: [
        {
          id: "e0",
          source: "s1",
          sourceHandle: "out_default",
          target: "py1",
          targetHandle: "in_default",
          condition: null,
        },
        {
          id: "eerr",
          source: "py1",
          sourceHandle: "out_error",
          target: "t1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    };
    const issues = findBranchAmbiguities(doc).filter((x) => x.kind === "out_error_unreachable");
    expect(issues).toHaveLength(0);
  });

  it("flags unclosed template condition on edge", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "echo" } },
      ],
      edges: [
        {
          id: "e_bad",
          source: "s1",
          target: "t1",
          condition: "{{node_outputs.t1",
        },
      ],
    };
    const issues = findBranchAmbiguities(doc).filter((x) => x.kind === "template_condition_invalid");
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toBe("unclosed");
    expect(issues[0].edgeId).toBe("e_bad");
  });

  it("flags too_long template condition", () => {
    const pad = "x".repeat(MAX_EDGE_CONDITION_CHARS);
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "echo" } },
      ],
      edges: [
        {
          id: "e_long",
          source: "s1",
          target: "t1",
          condition: `{{a}}${pad}`,
        },
      ],
    };
    const issues = findBranchAmbiguities(doc).filter((x) => x.kind === "template_condition_invalid");
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toBe("too_long");
  });

  it("does not flag valid template condition", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "echo" } },
      ],
      edges: [
        {
          id: "e_ok",
          source: "s1",
          target: "t1",
          condition: "{{node_outputs.t1.processResult.exitCode}} == 0",
        },
      ],
    };
    const issues = findBranchAmbiguities(doc).filter((x) => x.kind === "template_condition_invalid");
    expect(issues).toHaveLength(0);
  });

  it("edgeIdsForBranchAmbiguities lists all unconditional edges when multiple_unconditional", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "ffffffff-ffff-4fff-8fff-ffffffffffff", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "a", type: "task", position: { x: 0, y: 0 }, data: { command: "x" } },
        { id: "b", type: "task", position: { x: 0, y: 0 }, data: { command: "y" } },
      ],
      edges: [
        { id: "e1", source: "s1", target: "a", condition: null },
        { id: "e2", source: "s1", target: "b", condition: "  " },
      ],
    };
    const amb = findBranchAmbiguities(doc);
    expect(amb.some((x) => x.kind === "multiple_unconditional")).toBe(true);
    expect([...edgeIdsForBranchAmbiguities(doc, amb)].sort()).toEqual(["e1", "e2"]);
  });
});
