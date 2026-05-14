// Copyright GraphCaster. All Rights Reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDroppedEventLineCount,
  parseRunEventLine,
  peekRootGraphIdFromNdjson,
  resetDroppedEventLineCount,
} from "./parseRunEventLine";

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

describe("parseRunEventLine drop counter and rate-limited warn", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetDroppedEventLineCount();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    resetDroppedEventLineCount();
  });

  it("does not increment for empty/whitespace lines", () => {
    parseRunEventLine("");
    parseRunEventLine("   ");
    expect(getDroppedEventLineCount()).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("valid lines pass through and do not increment the drop counter", () => {
    const v = parseRunEventLine('{"type":"run_started","runId":"r1"}');
    expect(v).toEqual({ type: "run_started", runId: "r1" });
    expect(getDroppedEventLineCount()).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("invalid JSON increments the counter and warns the first 10 times", () => {
    for (let i = 0; i < 10; i++) {
      expect(parseRunEventLine("{not json")).toBeNull();
    }
    expect(getDroppedEventLineCount()).toBe(10);
    expect(warnSpy).toHaveBeenCalledTimes(10);
  });

  it("warns only every 100 drops after the first 10", () => {
    for (let i = 0; i < 100; i++) {
      parseRunEventLine("not-json-" + i);
    }
    // First 10 always warn; then no warn until drop #100.
    expect(getDroppedEventLineCount()).toBe(100);
    expect(warnSpy).toHaveBeenCalledTimes(11);

    for (let i = 100; i < 200; i++) {
      parseRunEventLine("nope-" + i);
    }
    // Drop #200 triggers the next sampled warn.
    expect(getDroppedEventLineCount()).toBe(200);
    expect(warnSpy).toHaveBeenCalledTimes(12);
  });

  it("warn message truncates line content to 200 chars", () => {
    const bigLine = "x".repeat(500);
    parseRunEventLine(bigLine);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("x".repeat(200));
    expect(msg).not.toContain("x".repeat(201));
  });

  it("mixed valid + invalid only counts invalid", () => {
    parseRunEventLine('{"type":"ok"}');
    parseRunEventLine("garbage");
    parseRunEventLine('{"type":"ok2"}');
    parseRunEventLine("more garbage");
    expect(getDroppedEventLineCount()).toBe(2);
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
