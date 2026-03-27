// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";
import { parseRunEventLine } from "./parseRunEventLine";

describe("parseRunEventLine", () => {
  it("returns null for empty or whitespace", () => {
    expect(parseRunEventLine("")).toBeNull();
    expect(parseRunEventLine("   ")).toBeNull();
  });

  it("parses run_started", () => {
    const line =
      '{"type":"run_started","runId":"r1","rootGraphId":"g1","startedAt":"2026-01-01T00:00:00Z","mode":"manual"}';
    const v = parseRunEventLine(line);
    expect(v).toEqual({
      type: "run_started",
      runId: "r1",
      rootGraphId: "g1",
      startedAt: "2026-01-01T00:00:00Z",
      mode: "manual",
    });
  });

  it("parses node_enter with nodeId", () => {
    const v = parseRunEventLine('{"type":"node_enter","nodeId":"n1","nodeType":"task"}');
    expect(v).toEqual({ type: "node_enter", nodeId: "n1", nodeType: "task" });
  });

  it("returns null on invalid JSON", () => {
    expect(parseRunEventLine("{")).toBeNull();
  });
});
