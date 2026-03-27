// Copyright GraphCaster. All Rights Reserved.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { findHandleCompatibilityIssues } from "./handleCompatibility";
import type { GraphDocumentJson } from "./types";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "schemas",
  "test-fixtures",
);

function loadFixture(name: string): GraphDocumentJson {
  const raw = readFileSync(join(FIXTURE_DIR, name), "utf8");
  return JSON.parse(raw) as GraphDocumentJson;
}

function baseDoc(): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: {
      schemaVersion: 1,
      graphId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      title: "t",
    },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "start1", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "echo" } },
      { id: "exit1", type: "exit", position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [],
  };
}

describe("findHandleCompatibilityIssues", () => {
  it("flags start node edge with invalid source handle out_error", () => {
    const doc = baseDoc();
    doc.edges = [
      {
        id: "e0",
        source: "start1",
        sourceHandle: "out_error",
        target: "t1",
        targetHandle: "in_default",
        condition: null,
      },
    ];
    const issues = findHandleCompatibilityIssues(doc);
    expect(issues.some((i) => i.kind === "invalid_source_handle")).toBe(true);
    expect(issues[0]?.kind).toBe("invalid_source_handle");
    if (issues[0]?.kind === "invalid_source_handle") {
      expect(issues[0].sourceId).toBe("start1");
      expect(issues[0].handle).toBe("out_error");
    }
  });

  it("flags exit node edge with invalid target handle", () => {
    const doc = baseDoc();
    doc.edges = [
      {
        id: "e1",
        source: "start1",
        sourceHandle: "out_default",
        target: "exit1",
        targetHandle: "out_default",
        condition: null,
      },
    ];
    const issues = findHandleCompatibilityIssues(doc);
    expect(issues.some((i) => i.kind === "invalid_target_handle")).toBe(true);
  });

  it("flags outgoing edge from exit (no allowed source handles)", () => {
    const doc = baseDoc();
    doc.edges = [
      {
        id: "e2",
        source: "exit1",
        sourceHandle: "out_default",
        target: "t1",
        targetHandle: "in_default",
        condition: null,
      },
    ];
    const issues = findHandleCompatibilityIssues(doc);
    expect(issues.some((i) => i.kind === "invalid_source_handle" && i.sourceId === "exit1")).toBe(true);
  });

  it("accepts valid example handles start → task → exit", () => {
    const doc = baseDoc();
    doc.edges = [
      {
        id: "e1",
        source: "start1",
        sourceHandle: "out_default",
        target: "t1",
        targetHandle: "in_default",
        condition: null,
      },
      {
        id: "e2",
        source: "t1",
        sourceHandle: "out_default",
        target: "exit1",
        targetHandle: "in_default",
        condition: null,
      },
    ];
    expect(findHandleCompatibilityIssues(doc)).toEqual([]);
  });

  it("skips edges touching comment nodes", () => {
    const doc = baseDoc();
    doc.nodes = [
      ...(doc.nodes ?? []),
      { id: "c1", type: "comment", position: { x: 0, y: 0 }, data: {} },
    ];
    doc.edges = [
      {
        id: "ec",
        source: "start1",
        sourceHandle: "out_default",
        target: "c1",
        targetHandle: "in_default",
        condition: null,
      },
    ];
    expect(findHandleCompatibilityIssues(doc)).toEqual([]);
  });

  it("fixture handle-ok.json has no issues", () => {
    expect(findHandleCompatibilityIssues(loadFixture("handle-ok.json"))).toEqual([]);
  });

  it("fixture handle-bad-start-out.json flags invalid source handle", () => {
    const issues = findHandleCompatibilityIssues(loadFixture("handle-bad-start-out.json"));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe("invalid_source_handle");
  });

  it("fixture handle-bad-exit-in.json flags invalid target handle", () => {
    const issues = findHandleCompatibilityIssues(loadFixture("handle-bad-exit-in.json"));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe("invalid_target_handle");
  });
});
