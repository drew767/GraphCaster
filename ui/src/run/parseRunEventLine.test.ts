// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";
import { parseRunEventLine, peekRootGraphIdFromNdjson } from "./parseRunEventLine";

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

  it("parses agent_step", () => {
    const v = parseRunEventLine(
      '{"type":"agent_step","nodeId":"n1","graphId":"g1","attempt":0,"phase":"llm","message":"x"}',
    );
    expect(v).toEqual({
      type: "agent_step",
      nodeId: "n1",
      graphId: "g1",
      attempt: 0,
      phase: "llm",
      message: "x",
    });
  });
});

describe("peekRootGraphIdFromNdjson", () => {
  it("returns rootGraphId from first run_started line", () => {
    const ndjson = [
      '{"type":"noise","x":1}',
      '{"type":"run_started","runId":"r1","rootGraphId":"my-graph","mode":"manual"}',
      '{"type":"node_enter","nodeId":"a"}',
    ].join("\n");
    expect(peekRootGraphIdFromNdjson(ndjson)).toBe("my-graph");
  });

  it("returns null when no run_started", () => {
    expect(peekRootGraphIdFromNdjson('{"type":"node_enter","nodeId":"a"}')).toBeNull();
  });

  it("returns null for empty rootGraphId string", () => {
    expect(
      peekRootGraphIdFromNdjson('{"type":"run_started","runId":"r1","rootGraphId":"   "}'),
    ).toBeNull();
  });
});
